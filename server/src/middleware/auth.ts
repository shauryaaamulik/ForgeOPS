import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { hasPermission, type Permission } from "../modules/auth/rbac.js";
import { verifyAccessToken, type AuthClaims } from "../modules/auth/tokens.js";
import { HttpError } from "./errors.js";

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthClaims;
  }
}

export const authenticate =
  (accessSecret: string): RequestHandler =>
  (req, _res, next) => {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) return next(new HttpError(401, "Missing bearer token"));
    try {
      req.auth = verifyAccessToken(header.slice(7), accessSecret);
      next();
    } catch {
      next(new HttpError(401, "Invalid or expired token"));
    }
  };

export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(new HttpError(401, "Not authenticated"));
    if (!hasPermission(req.auth.role, permission)) return next(new HttpError(403, "Forbidden"));
    next();
  };

/**
 * The tenant always comes from the verified token, never from the request body
 * or query string, so a client cannot read or write another tenant's data.
 */
export function tenantOf(req: { auth?: AuthClaims }): Types.ObjectId {
  if (!req.auth) throw new HttpError(401, "Not authenticated");
  return new Types.ObjectId(req.auth.tenantId);
}
