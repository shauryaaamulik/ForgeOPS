import { Schema, model, type InferSchemaType } from "mongoose";
import { ROLES } from "./rbac.js";

const tenantSchema = new Schema(
  { name: { type: String, required: true, trim: true } },
  { timestamps: true },
);
export const Tenant = model("Tenant", tenantSchema);

const userSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
  },
  { timestamps: true },
);
// Emails are unique per tenant, and every tenant-scoped lookup starts with tenantId.
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
export const User = model("User", userSchema);
export type UserDoc = InferSchemaType<typeof userSchema>;

const refreshTokenSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true },
  userId: { type: Schema.Types.ObjectId, required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
});
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup
export const RefreshToken = model("RefreshToken", refreshTokenSchema);
