import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { authenticate, requirePermission, tenantOf } from "../../middleware/auth.js";
import { asyncHandler, HttpError } from "../../middleware/errors.js";
import { Material, StockMovement } from "./models.js";
import { availableQty } from "./stock.js";

const createBody = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  unit: z.string().min(1).default("kg"),
  onHand: z.number().min(0).default(0),
  reorderLevel: z.number().min(0).default(0),
});
const receiveBody = z.object({ quantity: z.number().positive(), note: z.string().optional() });

export function inventoryRouter(env: Env): Router {
  const router = Router();
  router.use(authenticate(env.JWT_ACCESS_SECRET));

  router.get(
    "/materials",
    requirePermission("inventory:read"),
    asyncHandler(async (req, res) => {
      const items = await Material.find({ tenantId: tenantOf(req) }).sort({ sku: 1 }).lean();
      res.json(items.map((m) => ({ ...m, available: availableQty(m.onHand, m.reserved), lowStock: availableQty(m.onHand, m.reserved) <= (m.reorderLevel ?? 0) })));
    }),
  );

  router.post(
    "/materials",
    requirePermission("inventory:write"),
    asyncHandler(async (req, res) => {
      const body = createBody.parse(req.body);
      const tenantId = tenantOf(req);
      try {
        const material = await Material.create({ ...body, tenantId });
        if (body.onHand > 0) await StockMovement.create({ tenantId, materialId: material._id, type: "RECEIPT", quantity: body.onHand, note: "Opening balance" });
        res.status(201).json(material);
      } catch (e) {
        if ((e as { code?: number }).code === 11000) throw new HttpError(409, "SKU already exists");
        throw e;
      }
    }),
  );

  router.post(
    "/materials/:id/receive",
    requirePermission("inventory:write"),
    asyncHandler(async (req, res) => {
      const body = receiveBody.parse(req.body);
      const tenantId = tenantOf(req);
      const rawId = req.params.id ?? "";
      if (!Types.ObjectId.isValid(rawId)) throw new HttpError(404, "Material not found");
      const material = await Material.findOneAndUpdate({ _id: new Types.ObjectId(rawId), tenantId }, { $inc: { onHand: body.quantity } }, { new: true });
      if (!material) throw new HttpError(404, "Material not found");
      await StockMovement.create({ tenantId, materialId: material._id, type: "RECEIPT", quantity: body.quantity, note: body.note });
      res.json(material);
    }),
  );

  return router;
}
