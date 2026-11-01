import { describe, expect, it } from "vitest";
import { calculateOee } from "../src/modules/analytics/oee.js";
import { hasPermission } from "../src/modules/auth/rbac.js";
import { availableQty, canReserve } from "../src/modules/inventory/stock.js";
import { checkCapacity } from "../src/modules/production/scheduling.js";

describe("calculateOee", () => {
  it("matches a hand-computed example", () => {
    // 8h planned, 1h down -> A = 7/8. Ideal 30s/part, 750 parts in 7h -> P = 22500/25200.
    // 720 good of 750 -> Q = 0.96.
    const r = calculateOee({
      plannedTimeSec: 28_800,
      downtimeSec: 3_600,
      idealCycleTimeSec: 30,
      totalCount: 750,
      goodCount: 720,
    });
    expect(r.availability).toBeCloseTo(0.875, 6);
    expect(r.performance).toBeCloseTo(22_500 / 25_200, 6);
    expect(r.quality).toBeCloseTo(0.96, 6);
    expect(r.oee).toBeCloseTo(0.875 * (22_500 / 25_200) * 0.96, 6);
  });

  it("caps performance at 1 and never returns NaN", () => {
    const fast = calculateOee({ plannedTimeSec: 100, downtimeSec: 0, idealCycleTimeSec: 10, totalCount: 50, goodCount: 50 });
    expect(fast.performance).toBe(1);
    const idle = calculateOee({ plannedTimeSec: 100, downtimeSec: 100, idealCycleTimeSec: 10, totalCount: 0, goodCount: 0 });
    expect(idle.oee).toBe(0);
  });

  it("rejects impossible inputs", () => {
    expect(() => calculateOee({ plannedTimeSec: 10, downtimeSec: 20, idealCycleTimeSec: 1, totalCount: 1, goodCount: 1 })).toThrow(RangeError);
    expect(() => calculateOee({ plannedTimeSec: 10, downtimeSec: 0, idealCycleTimeSec: 1, totalCount: 1, goodCount: 2 })).toThrow(RangeError);
  });
});

describe("rbac", () => {
  it("limits what each role can do", () => {
    expect(hasPermission("admin", "users:manage")).toBe(true);
    expect(hasPermission("manager", "users:manage")).toBe(false);
    expect(hasPermission("viewer", "inventory:write")).toBe(false);
    expect(hasPermission("operator", "telemetry:ingest")).toBe(true);
  });
});

describe("stock", () => {
  it("computes availability and reservation eligibility", () => {
    expect(availableQty(100, 30)).toBe(70);
    expect(availableQty(10, 30)).toBe(0);
    expect(canReserve(100, 30, 70)).toBe(true);
    expect(canReserve(100, 30, 71)).toBe(false);
    expect(canReserve(100, 0, 0)).toBe(false);
  });
});

describe("checkCapacity", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  it("accepts work that fits before the deadline", () => {
    // 10 days * 16h = 160h available; 500 units at 5/h = 100h.
    const r = checkCapacity({ quantity: 500, ratedUnitsPerHour: 5, bookedHours: 0, now, deadline: new Date("2026-11-11T00:00:00Z") });
    expect(r.feasible).toBe(true);
    expect(r.requiredHours).toBe(100);
    expect(r.availableHours).toBe(160);
  });
  it("rejects work when the machine is already booked", () => {
    const r = checkCapacity({ quantity: 500, ratedUnitsPerHour: 5, bookedHours: 80, now, deadline: new Date("2026-11-11T00:00:00Z") });
    expect(r.feasible).toBe(false);
  });
  it("rejects past deadlines", () => {
    const r = checkCapacity({ quantity: 1, ratedUnitsPerHour: 5, bookedHours: 0, now, deadline: new Date("2026-10-01T00:00:00Z") });
    expect(r.feasible).toBe(false);
  });
});
