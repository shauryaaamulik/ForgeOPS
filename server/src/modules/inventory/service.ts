import type { ClientSession, Types } from "mongoose";
import { HttpError } from "../../middleware/errors.js";
import { Material, Reservation } from "./models.js";

/**
 * Reserve stock for a work order.
 *
 * The availability check and the increment happen in ONE atomic update
 * (the filter only matches when onHand - reserved >= quantity), so two
 * concurrent orders can never both claim the same stock. Running inside the
 * caller's transaction also guarantees that if a later step fails (for example
 * the second material is short), every earlier reservation is rolled back.
 */
export async function reserveMaterial(
  args: { tenantId: Types.ObjectId; workOrderId: Types.ObjectId; materialId: Types.ObjectId; quantity: number },
  session: ClientSession,
): Promise<void> {
  const { tenantId, workOrderId, materialId, quantity } = args;
  if (!(quantity > 0)) throw new HttpError(400, "Reservation quantity must be positive");

  const updated = await Material.findOneAndUpdate(
    {
      _id: materialId,
      tenantId,
      $expr: { $gte: [{ $subtract: ["$onHand", "$reserved"] }, quantity] },
    },
    { $inc: { reserved: quantity } },
    { session, new: true },
  );

  if (!updated) {
    const exists = await Material.exists({ _id: materialId, tenantId }).session(session);
    throw exists
      ? new HttpError(409, "Insufficient available stock", "INSUFFICIENT_STOCK")
      : new HttpError(404, "Material not found");
  }

  await Reservation.create([{ tenantId, workOrderId, materialId, quantity }], { session });
}

/** Release all active reservations of a work order (e.g. when it is cancelled). */
export async function releaseReservations(
  args: { tenantId: Types.ObjectId; workOrderId: Types.ObjectId },
  session: ClientSession,
): Promise<void> {
  const active = await Reservation.find({ ...args, status: "ACTIVE" }).session(session);
  for (const r of active) {
    await Material.updateOne({ _id: r.materialId, tenantId: r.tenantId }, { $inc: { reserved: -r.quantity } }, { session });
    r.status = "RELEASED";
    await r.save({ session });
  }
}
