import { Schema, model } from "mongoose";

const machineSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    ratedUnitsPerHour: { type: Number, required: true, min: 0.0001 },
    status: { type: String, enum: ["RUNNING", "IDLE", "DOWN"], default: "IDLE" },
    lastTelemetryAt: Date,
    // Last cumulative counters reported by the machine, used to compute per-reading deltas.
    lastProductionCount: { type: Number, default: 0 },
    lastDefectCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
machineSchema.index({ tenantId: 1, code: 1 }, { unique: true });
export const Machine = model("Machine", machineSchema);
