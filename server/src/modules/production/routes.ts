import mongoose, { Schema, Types, model } from "mongoose";
import { Router } from "express";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { authenticate, requirePermission, tenantOf } from "../../middleware/auth.js";
import { asyncHandler, HttpError } from "../../middleware/errors.js";
import { releaseReservations, reserveMaterial } from "../inventory/service.js";
import { Machine } from "../machines/routes.js";
import { checkCapacity } from "./scheduling.js";

const workOrderSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    product: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    machineId: { type: Schema.Types.ObjectId, required: true },
    deadline: { type: Date, required: true },
    status: { type: String, enum: ["SCHEDULED", "IN_PROGRESS", "DONE", "CANCELLED"], default: "SCHEDULED" },
    materials: [{ materialId: Schema.Types.ObjectId, quantity: Number, _id: false }],
  },
  { timestamps: true },
);
workOrderSchema.index({ tenantId: 1, status: 1, deadline: 1 });
workOrderSchema.index({ tenantId: 1, machineId: 1, status: 1 });
export const WorkOrder = model("WorkOrder", workOrderSchema);

const createBody = z.object({
  product: z.string().min(1),
  quantity: z.number().int().positive(),
  machineCode: z.string().min(1),
  deadline: z.coerce.date(),
  materials: z.array(z.object({ materialId: z.string().length(24), quantity: z.number().positive() })).default([]),
});

export function productionRouter(env: Env): Router {
  const router = Router();
  router.use(authenticate(env.JWT_ACCESS_SECRET));

  router.get(
    "/work-orders",
    requirePermission("workorders:read"),
    asyncHandler(async (req, res) => {
      res.json(await WorkOrder.find({ tenantId: tenantOf(req) }).sort({ deadline: 1 }).lean());
    }),
  );

  // Checks machine capacity, then reserves every material in one transaction:
  // either the whole order is scheduled, or nothing is reserved.
  router.post(
    "/work-orders",
    requirePermission("workorders:write"),
    asyncHandler(async (req, res) => {
      const body = createBody.parse(req.body);
      const tenantId = tenantOf(req);

      const machine = await Machine.findOne({ tenantId, code: body.machineCode });
      if (!machine) throw new HttpError(404, "Machine not found");

      const open = await WorkOrder.find({ tenantId, machineId: machine._id, status: { $in: ["SCHEDULED", "IN_PROGRESS"] } }, { quantity: 1 }).lean();
      const bookedHours = open.reduce((sum, o) => sum + o.quantity / machine.ratedUnitsPerHour, 0);
      const capacity = checkCapacity({
        quantity: body.quantity,
        ratedUnitsPerHour: machine.ratedUnitsPerHour,
        bookedHours,
        now: new Date(),
        deadline: body.deadline,
      });
      if (!capacity.feasible) {
        throw new HttpError(409, `Machine cannot meet the deadline (needs ${capacity.requiredHours.toFixed(1)}h, ${capacity.availableHours.toFixed(1)}h free)`, "CAPACITY_EXCEEDED");
      }

      const session = await mongoose.startSession();
      try {
        let created: InstanceType<typeof WorkOrder> | undefined;
        await session.withTransaction(async () => {
          const workOrderId = new Types.ObjectId();
          for (const m of body.materials) {
            await reserveMaterial({ tenantId, workOrderId, materialId: new Types.ObjectId(m.materialId), quantity: m.quantity }, session);
          }
          const [doc] = await WorkOrder.create(
            [{ _id: workOrderId, tenantId, product: body.product, quantity: body.quantity, machineId: machine._id, deadline: body.deadline, materials: body.materials }],
            { session },
          );
          created = doc;
        });
        res.status(201).json(created);
      } finally {
        await session.endSession();
      }
    }),
  );

  router.post(
    "/work-orders/:id/cancel",
    requirePermission("workorders:write"),
    asyncHandler(async (req, res) => {
      const tenantId = tenantOf(req);
      const rawId = req.params.id ?? "";
      if (!Types.ObjectId.isValid(rawId)) throw new HttpError(404, "Work order not found");
      const workOrderId = new Types.ObjectId(rawId);
      const session = await mongoose.startSession();
      try {
        let result: InstanceType<typeof WorkOrder> | null = null;
        await session.withTransaction(async () => {
          const wo = await WorkOrder.findOneAndUpdate(
            { _id: workOrderId, tenantId, status: { $in: ["SCHEDULED", "IN_PROGRESS"] } },
            { status: "CANCELLED" },
            { session, new: true },
          );
          if (!wo) throw new HttpError(404, "Open work order not found");
          await releaseReservations({ tenantId, workOrderId }, session);
          result = wo;
        });
        res.json(result);
      } finally {
        await session.endSession();
      }
    }),
  );

  return router;
}
