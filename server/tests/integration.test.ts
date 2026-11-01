import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

let replSet: MongoMemoryReplSet;
let app: ReturnType<typeof createApp>;

const env = loadEnv({
  NODE_ENV: "test",
  MONGO_URI: "mongodb://unused",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
});

async function registerTenant(company: string, email: string) {
  const res = await request(app).post("/api/auth/register").send({ companyName: company, name: "Admin", email, password: "password123" });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken as string, tenantId: res.body.tenantId as string };
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  // Transactions need a replica set, so the in-memory server runs as one.
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await mongoose.syncIndexes();
  app = createApp(env);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

describe("auth and tenancy", () => {
  it("rejects requests without a token", async () => {
    expect((await request(app).get("/api/inventory/materials")).status).toBe(401);
  });

  it("keeps each tenant's data isolated", async () => {
    const a = await registerTenant("Factory A", "a@example.com");
    const b = await registerTenant("Factory B", "b@example.com");
    await request(app).post("/api/inventory/materials").set(bearer(a.token)).send({ sku: "STEEL", name: "Steel", onHand: 100 }).expect(201);

    const listB = await request(app).get("/api/inventory/materials").set(bearer(b.token)).expect(200);
    expect(listB.body).toEqual([]);
    const listA = await request(app).get("/api/inventory/materials").set(bearer(a.token)).expect(200);
    expect(listA.body).toHaveLength(1);
  });

  it("enforces role permissions", async () => {
    const t = await registerTenant("Factory C", "c@example.com");
    await request(app).post("/api/auth/users").set(bearer(t.token)).send({ name: "View", email: "v@example.com", password: "password123", role: "viewer" }).expect(201);
    const login = await request(app).post("/api/auth/login").send({ tenantId: t.tenantId, email: "v@example.com", password: "password123" }).expect(200);
    await request(app).post("/api/inventory/materials").set(bearer(login.body.accessToken)).send({ sku: "X", name: "X" }).expect(403);
  });
});

describe("work orders and reservations", () => {
  it("never double-allocates stock and rolls back partial reservations", async () => {
    const t = await registerTenant("Factory D", "d@example.com");
    const h = bearer(t.token);
    const steel = (await request(app).post("/api/inventory/materials").set(h).send({ sku: "STEEL", name: "Steel", onHand: 300 }).expect(201)).body;
    const brass = (await request(app).post("/api/inventory/materials").set(h).send({ sku: "BRASS", name: "Brass", onHand: 10 }).expect(201)).body;
    await request(app).post("/api/machines").set(h).send({ code: "CNC-003", name: "CNC 3", ratedUnitsPerHour: 10 }).expect(201);
    const deadline = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const order = (materials: unknown[]) => request(app).post("/api/production/work-orders").set(h).send({ product: "Gear Shaft", quantity: 50, machineCode: "CNC-003", deadline, materials });

    // 200 of 300 kg reserved.
    await order([{ materialId: steel._id, quantity: 200 }]).expect(201);
    // Another 200 kg must fail: only 100 kg remain available.
    const second = await order([{ materialId: steel._id, quantity: 200 }]);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("INSUFFICIENT_STOCK");

    // Steel is fine (100 left) but brass is short: the steel reservation must roll back.
    const third = await order([{ materialId: steel._id, quantity: 50 }, { materialId: brass._id, quantity: 999 }]);
    expect(third.status).toBe(409);
    const mats = (await request(app).get("/api/inventory/materials").set(h).expect(200)).body as Array<{ sku: string; reserved: number }>;
    expect(mats.find((m) => m.sku === "STEEL")?.reserved).toBe(200);
  });

  it("handles concurrent orders without over-reserving", async () => {
    const t = await registerTenant("Factory E", "e@example.com");
    const h = bearer(t.token);
    const mat = (await request(app).post("/api/inventory/materials").set(h).send({ sku: "ALU", name: "Aluminium", onHand: 100 }).expect(201)).body;
    await request(app).post("/api/machines").set(h).send({ code: "M1", name: "M1", ratedUnitsPerHour: 100 }).expect(201);
    const deadline = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post("/api/production/work-orders").set(h).send({ product: "P", quantity: 10, machineCode: "M1", deadline, materials: [{ materialId: mat._id, quantity: 40 }] }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBeLessThanOrEqual(2); // 100 kg / 40 kg => at most 2 succeed
    const mats = (await request(app).get("/api/inventory/materials").set(h)).body as Array<{ reserved: number }>;
    expect(mats[0]?.reserved).toBe(ok * 40);
  });

  it("rejects work the machine cannot finish by the deadline", async () => {
    const t = await registerTenant("Factory F", "f@example.com");
    const h = bearer(t.token);
    await request(app).post("/api/machines").set(h).send({ code: "SLOW", name: "Slow", ratedUnitsPerHour: 1 }).expect(201);
    const res = await request(app).post("/api/production/work-orders").set(h).send({ product: "P", quantity: 500, machineCode: "SLOW", deadline: new Date(Date.now() + 86_400_000).toISOString(), materials: [] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CAPACITY_EXCEEDED");
  });
});
