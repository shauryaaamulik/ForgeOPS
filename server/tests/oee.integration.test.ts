import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

let replSet: MongoMemoryReplSet;
let app: ReturnType<typeof createApp>;
const published: Array<{ tenantId: string; event: string }> = [];

const env = loadEnv({
  NODE_ENV: "test",
  MONGO_URI: "mongodb://unused",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
});

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await mongoose.syncIndexes();
  app = createApp(env, (tenantId, event) => published.push({ tenantId, event }));
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

async function setup(email: string) {
  const res = await request(app).post("/api/auth/register").send({ companyName: "Plant", name: "Admin", email, password: "password123" }).expect(201);
  return { h: { Authorization: `Bearer ${res.body.accessToken as string}` }, tenantId: res.body.tenantId as string };
}

describe("telemetry persistence and OEE", () => {
  it("derives availability, performance, quality and OEE from stored readings", async () => {
    const { h, tenantId } = await setup("oee@example.com");
    await request(app).post("/api/machines").set(h).send({ code: "M1", name: "M1", ratedUnitsPerHour: 60 }).expect(201);

    // Timeline starts one hour ago so every interval is closed or ends inside the window.
    const t0 = Date.now() - 3_600_000;
    const at = (sec: number) => new Date(t0 + sec * 1000).toISOString();
    const post = (sec: number, status: string, count: number, defects: number) =>
      request(app).post("/api/machines/M1/telemetry").set(h).send({ status, productionCount: count, defectCount: defects, timestamp: at(sec) }).expect(202);

    await post(0, "RUNNING", 0, 0);
    await post(600, "DOWN", 10, 1); // ran 600s, made 10 parts, 1 defect
    await post(900, "RUNNING", 10, 1); // down 300s
    await post(1200, "RUNNING", 15, 1); // ran 300s more, 5 more parts

    // Window 1200s: running 600 + 300 = 900s, down 300s. Ideal cycle = 60s/part.
    const res = await request(app).get("/api/analytics/oee").query({ machineCode: "M1", from: at(0), to: at(1200) }).set(h).expect(200);
    const m = res.body.machines[0];
    expect(m.runSec).toBeCloseTo(900, 3);
    expect(m.downtimeSec).toBeCloseTo(300, 3);
    expect(m.produced).toBe(15);
    expect(m.defects).toBe(1);
    expect(m.availability).toBeCloseTo(0.75, 6);
    expect(m.performance).toBeCloseTo(1, 6); // 60s * 15 / 900s
    expect(m.quality).toBeCloseTo(14 / 15, 6);
    expect(m.oee).toBeCloseTo(0.75 * (14 / 15), 6);
    expect(published.filter((p) => p.tenantId === tenantId && p.event === "machine:telemetry")).toHaveLength(4);
  });

  it("treats a counter reset as new production, not negative output", async () => {
    const { h } = await setup("reset@example.com");
    await request(app).post("/api/machines").set(h).send({ code: "R1", name: "R1", ratedUnitsPerHour: 60 }).expect(201);
    const t0 = Date.now() - 600_000;
    const at = (sec: number) => new Date(t0 + sec * 1000).toISOString();
    for (const [sec, count] of [[0, 0], [60, 100], [120, 5]] as const) {
      await request(app).post("/api/machines/R1/telemetry").set(h).send({ status: "RUNNING", productionCount: count, timestamp: at(sec) }).expect(202);
    }
    const res = await request(app).get("/api/analytics/oee").query({ machineCode: "R1", from: at(0), to: at(120) }).set(h).expect(200);
    expect(res.body.machines[0].produced).toBe(105);
  });

  it("isolates analytics by tenant and validates the window", async () => {
    const a = await setup("ta@example.com");
    const b = await setup("tb@example.com");
    await request(app).post("/api/machines").set(a.h).send({ code: "ONLY-A", name: "A", ratedUnitsPerHour: 10 }).expect(201);
    expect((await request(app).get("/api/analytics/oee").set(b.h).expect(200)).body.machines).toEqual([]);
    await request(app).get("/api/analytics/oee").query({ machineCode: "ONLY-A" }).set(b.h).expect(404);
    await request(app).get("/api/analytics/oee").query({ from: "2026-02-01", to: "2026-01-01" }).set(a.h).expect(400);
    await request(app).get("/api/analytics/oee").query({ from: "2025-01-01", to: "2026-01-01" }).set(a.h).expect(400);
  });
});
