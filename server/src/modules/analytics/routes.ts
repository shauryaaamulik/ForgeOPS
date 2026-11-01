import { Router } from "express";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { authenticate, requirePermission, tenantOf } from "../../middleware/auth.js";
import { asyncHandler, HttpError } from "../../middleware/errors.js";
import { Machine } from "../machines/models.js";
import { ProductionSample, StatusEvent } from "../machines/telemetry.js";
import { overlapSeconds } from "./intervals.js";
import { calculateOee } from "./oee.js";

const MAX_WINDOW_MS = 31 * 86_400_000;

const query = z.object({
  machineCode: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export function analyticsRouter(env: Env): Router {
  const router = Router();
  router.use(authenticate(env.JWT_ACCESS_SECRET));

  /**
   * OEE per machine over a window (default: last 24 hours).
   *  - planned time = the whole window
   *  - availability = time in RUNNING / window (IDLE and DOWN both count as lost time)
   *  - performance  = (ideal cycle time x produced) / run time, capped at 1
   *  - quality      = (produced - defects) / produced
   */
  router.get(
    "/oee",
    requirePermission("analytics:read"),
    asyncHandler(async (req, res) => {
      const q = query.parse(req.query);
      const now = new Date();
      const to = q.to ?? now;
      const from = q.from ?? new Date(to.getTime() - 86_400_000);
      if (!(from < to)) throw new HttpError(400, "'from' must be before 'to'");
      if (to.getTime() - from.getTime() > MAX_WINDOW_MS) throw new HttpError(400, "Window cannot exceed 31 days");

      const tenantId = tenantOf(req);
      const machines = await Machine.find({ tenantId, ...(q.machineCode ? { code: q.machineCode } : {}) }).sort({ code: 1 }).lean();
      if (q.machineCode && machines.length === 0) throw new HttpError(404, "Machine not found");
      const ids = machines.map((m) => m._id);

      const [events, totals] = await Promise.all([
        StatusEvent.find({
          tenantId,
          machineId: { $in: ids },
          status: "RUNNING",
          startedAt: { $lt: to },
          $or: [{ endedAt: null }, { endedAt: { $gt: from } }],
        }).lean(),
        ProductionSample.aggregate<{ _id: unknown; produced: number; defects: number }>([
          { $match: { tenantId, machineId: { $in: ids }, at: { $gte: from, $lte: to } } },
          { $group: { _id: "$machineId", produced: { $sum: "$produced" }, defects: { $sum: "$defects" } } },
        ]),
      ]);

      const windowSec = (to.getTime() - from.getTime()) / 1000;
      const results = machines.map((m) => {
        const runSec = overlapSeconds(
          events.filter((e) => String(e.machineId) === String(m._id)).map((e) => ({ start: e.startedAt, end: e.endedAt ?? null })),
          from,
          to,
          now,
        );
        const t = totals.find((x) => String(x._id) === String(m._id));
        const produced = t?.produced ?? 0;
        const defects = Math.min(t?.defects ?? 0, produced);
        const oee = calculateOee({
          plannedTimeSec: windowSec,
          downtimeSec: Math.min(windowSec, Math.max(0, windowSec - runSec)),
          idealCycleTimeSec: 3600 / m.ratedUnitsPerHour,
          totalCount: produced,
          goodCount: produced - defects,
        });
        return { machineCode: m.code, windowSec, runSec, downtimeSec: windowSec - runSec, produced, defects, ...oee };
      });

      res.json({ from: from.toISOString(), to: to.toISOString(), machines: results });
    }),
  );

  return router;
}
