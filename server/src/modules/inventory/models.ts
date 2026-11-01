import { Schema, model } from "mongoose";

const materialSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    unit: { type: String, required: true, default: "kg" },
    onHand: { type: Number, required: true, min: 0, default: 0 },
    reserved: { type: Number, required: true, min: 0, default: 0 },
    reorderLevel: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);
materialSchema.index({ tenantId: 1, sku: 1 }, { unique: true });
export const Material = model("Material", materialSchema);

const reservationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    workOrderId: { type: Schema.Types.ObjectId, required: true },
    materialId: { type: Schema.Types.ObjectId, required: true },
    quantity: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["ACTIVE", "RELEASED", "CONSUMED"], default: "ACTIVE" },
  },
  { timestamps: true },
);
reservationSchema.index({ tenantId: 1, workOrderId: 1 });
export const Reservation = model("Reservation", reservationSchema);

const movementSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    materialId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ["RECEIPT", "ADJUSTMENT", "ISSUE"], required: true },
    quantity: { type: Number, required: true },
    note: String,
  },
  { timestamps: true },
);
movementSchema.index({ tenantId: 1, materialId: 1, createdAt: -1 });
export const StockMovement = model("StockMovement", movementSchema);
