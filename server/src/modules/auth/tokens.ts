import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Role } from "./rbac.js";

export interface AuthClaims {
  sub: string; // user id
  tenantId: string;
  role: Role;
}

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;

export const signAccessToken = (claims: AuthClaims, secret: string): string =>
  jwt.sign(claims, secret, { expiresIn: ACCESS_TTL_SEC });

export function verifyAccessToken(token: string, secret: string): AuthClaims {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === "string") throw new Error("Malformed token");
  const { sub, tenantId, role } = decoded as Partial<AuthClaims>;
  if (!sub || !tenantId || !role) throw new Error("Malformed token");
  return { sub, tenantId, role };
}

/** Refresh tokens are opaque random strings; only their SHA-256 hash is stored. */
export const newRefreshToken = (): string => randomBytes(48).toString("base64url");
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
