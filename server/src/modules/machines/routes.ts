import { Router } from "express";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { authenticate, requirePermission, tenantOf } from "../../middleware/auth.js";
import { asyncHandler, HttpError } from "../../middleware/errors.js";
import { Machine } from "./models.js";
import { recordReading } from "./telemetry.js";

const createBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  ratedUnitsPerHour: z.number().positive(),
});

const telemetryBody = z.object({
  status: z.enum(["RUNNING", "IDLE", "DOWN"]),
  temperature: z.number().optional(),
  rpm: z.number().min(0).optional(),
  // Cumulative counters since the machine started; the server stores per-reading deltas.
  productionCount: z.number().int().min(0).optional(),
  defectCount: z.number().int().min(0).optional(),
  timestamp: z.string().datetime().optional(),
});

export type Publish = (tenantId: string, event: string, payload: unknown) => void;

export function machinesRouter(env: Env, publish: Publish): Router {
  const router = Router();
  router.use(authenticate(env.JWT_ACCESS_SECRET));

  router.get(
    "/",
    requirePermission("machines:read"),
    asyncHandler(async (req, res) => {
      res.json(await Machine.find({ tenantId: tenantOf(req) }).sort({ code: 1 }).lean());
    }),
  );

  router.post(
    "/",
    requirePermission("machines:write"),
    asyncHandler(async (req, res) => {
      const body = createBody.parse(req.body);
      try {
        res.status(201).json(await Machine.create({ ...body, tenantId: tenantOf(req) }));
      } catch (e) {
        if ((e as { code?: number }).code === 11000) throw new HttpError(409, "Machine code already exists");
        throw e;
      }
    }),
  );

  // Simulators and shop-floor gateways post readings here; connected dashboards receive them live.
  router.post(
    "/:code/telemetry",
    requirePermission("telemetry:ingest"),
    asyncHandler(async (req, res) => {
      const body = telemetryBody.parse(req.body);
      const tenantId = tenantOf(req);
      const code = req.params.code ?? "";
      const at = body.timestamp ? new Date(body.timestamp) : new Date();
      const found = await recordReading(tenantId, code, {
        status: body.status,
        productionCount: body.productionCount,
        defectCount: body.defectCount,
        at,
      });
      if (!found) throw new HttpError(404, "Machine not found");
      publish(String(tenantId), "machine:telemetry", { machineId: code, ...body, timestamp: at.toISOString() });
      res.status(202).json({ ok: true });
    }),
  );

  return router;
}
