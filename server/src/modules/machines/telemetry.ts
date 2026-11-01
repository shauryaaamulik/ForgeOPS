import { Schema, model, type Types } from "mongoose";
import { counterDelta } from "../analytics/intervals.js";
import { Machine } from "./models.js";

/** One row per period a machine spent in a status. endedAt is null while it is still in that status. */
const statusEventSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true },
  machineId: { type: Schema.Types.ObjectId, required: true },
  status: { type: String, enum: ["RUNNING", "IDLE", "DOWN"], required: true },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
});
statusEventSchema.index({ tenantId: 1, machineId: 1, startedAt: 1 });
statusEventSchema.index({ tenantId: 1, machineId: 1, endedAt: 1 });
export const StatusEvent = model("StatusEvent", statusEventSchema);

/** Production produced/rejected since the previous reading (deltas, not cumulative counters). */
const productionSampleSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true },
  machineId: { type: Schema.Types.ObjectId, required: true },
  at: { type: Date, required: true },
  produced: { type: Number, required: true, min: 0 },
  defects: { type: Number, required: true, min: 0 },
});
productionSampleSchema.index({ tenantId: 1, machineId: 1, at: 1 });
export const ProductionSample = model("ProductionSample", productionSampleSchema);

export interface Reading {
  status: "RUNNING" | "IDLE" | "DOWN";
  productionCount?: number;
  defectCount?: number;
  at: Date;
}

/**
 * Persist one telemetry reading: update the machine, roll the status interval
 * if the status changed, and store production deltas. Returns false if the
 * machine does not exist for this tenant. Assumes one reporter per machine.
 */
export async function recordReading(tenantId: Types.ObjectId, code: string, r: Reading): Promise<boolean> {
  const set: Record<string, unknown> = { status: r.status, lastTelemetryAt: r.at };
  if (r.productionCount !== undefined) set.lastProductionCount = r.productionCount;
  if (r.defectCount !== undefined) set.lastDefectCount = r.defectCount;

  // new: false returns the document as it was BEFORE this reading.
  const prev = await Machine.findOneAndUpdate({ tenantId, code }, { $set: set }, { new: false });
  if (!prev) return false;

  const open = await StatusEvent.findOne({ tenantId, machineId: prev._id, endedAt: null });
  if (!open) {
    await StatusEvent.create({ tenantId, machineId: prev._id, status: r.status, startedAt: r.at });
  } else if (open.status !== r.status) {
    // Never let an out-of-order reading produce a negative-length interval.
    open.endedAt = new Date(Math.max(r.at.getTime(), open.startedAt.getTime()));
    await open.save();
    await StatusEvent.create({ tenantId, machineId: prev._id, status: r.status, startedAt: open.endedAt });
  }

  const produced = r.productionCount === undefined ? 0 : counterDelta(r.productionCount, prev.lastProductionCount ?? 0);
  const defects = r.defectCount === undefined ? 0 : counterDelta(r.defectCount, prev.lastDefectCount ?? 0);
  if (produced > 0 || defects > 0) {
    await ProductionSample.create({ tenantId, machineId: prev._id, at: r.at, produced, defects: Math.min(defects, produced) });
  }
  return true;
}
