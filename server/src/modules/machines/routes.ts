import { Router } from "express";
import { Schema, model } from "mongoose";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { authenticate, requirePermission, tenantOf } from "../../middleware/auth.js";
import { asyncHandler, HttpError } from "../../middleware/errors.js";

const machineSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    ratedUnitsPerHour: { type: Number, required: true, min: 0.0001 },
    status: { type: String, enum: ["RUNNING", "IDLE", "DOWN"], default: "IDLE" },
    lastTelemetryAt: Date,
  },
  { timestamps: true },
);
machineSchema.index({ tenantId: 1, code: 1 }, { unique: true });
export const Machine = model("Machine", machineSchema);

const createBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  ratedUnitsPerHour: z.number().positive(),
});

const telemetryBody = z.object({
  status: z.enum(["RUNNING", "IDLE", "DOWN"]),
  temperature: z.number().optional(),
  rpm: z.number().min(0).optional(),
  productionCount: z.number().int().min(0).optional(),
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
      const machine = await Machine.findOneAndUpdate(
        { tenantId, code: req.params.code },
        { status: body.status, lastTelemetryAt: new Date() },
        { new: true },
      );
      if (!machine) throw new HttpError(404, "Machine not found");
      publish(String(tenantId), "machine:telemetry", {
        machineId: machine.code,
        ...body,
        timestamp: body.timestamp ?? new Date().toISOString(),
      });
      res.status(202).json({ ok: true });
    }),
  );

  return router;
}
