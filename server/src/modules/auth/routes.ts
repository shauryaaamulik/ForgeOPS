import bcrypt from "bcryptjs";
import { Router, type Response } from "express";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { authenticate, requirePermission, tenantOf } from "../../middleware/auth.js";
import { asyncHandler, HttpError } from "../../middleware/errors.js";
import { ROLES, type Role } from "./rbac.js";
import { RefreshToken, Tenant, User } from "./models.js";
import { REFRESH_TTL_SEC, hashToken, newRefreshToken, signAccessToken } from "./tokens.js";

const COOKIE = "forgeops_refresh";

const registerBody = z.object({
  companyName: z.string().min(2),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});
const loginBody = z.object({
  tenantId: z.string().length(24),
  email: z.string().email(),
  password: z.string().min(1),
});
const createUserBody = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
});

export function authRouter(env: Env): Router {
  const router = Router();

  async function issueSession(res: Response, user: InstanceType<typeof User>) {
    const accessToken = signAccessToken(
      { sub: String(user._id), tenantId: String(user.tenantId), role: user.role as Role },
      env.JWT_ACCESS_SECRET,
    );
    const refresh = newRefreshToken();
    await RefreshToken.create({
      tenantId: user.tenantId,
      userId: user._id,
      tokenHash: hashToken(refresh),
      expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
    });
    res.cookie(COOKIE, refresh, {
      httpOnly: true,
      sameSite: "strict",
      secure: env.NODE_ENV === "production",
      maxAge: REFRESH_TTL_SEC * 1000,
      path: "/api/auth",
    });
    return accessToken;
  }

  // Creates a new tenant (factory) and its first admin user.
  router.post(
    "/register",
    asyncHandler(async (req, res) => {
      const body = registerBody.parse(req.body);
      const tenant = await Tenant.create({ name: body.companyName });
      const user = await User.create({
        tenantId: tenant._id,
        email: body.email,
        name: body.name,
        passwordHash: await bcrypt.hash(body.password, 12),
        role: "admin",
      });
      const accessToken = await issueSession(res, user);
      res.status(201).json({ accessToken, tenantId: String(tenant._id), user: { id: user.id, name: user.name, role: user.role } });
    }),
  );

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const body = loginBody.parse(req.body);
      const user = await User.findOne({ tenantId: body.tenantId, email: body.email.toLowerCase() });
      // Same message for unknown user and wrong password to avoid account enumeration.
      if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
        throw new HttpError(401, "Invalid credentials");
      }
      const accessToken = await issueSession(res, user);
      res.json({ accessToken, user: { id: user.id, name: user.name, role: user.role } });
    }),
  );

  // Rotating refresh: each token is single-use.
  router.post(
    "/refresh",
    asyncHandler(async (req, res) => {
      const presented = req.cookies?.[COOKIE] as string | undefined;
      if (!presented) throw new HttpError(401, "Missing refresh token");
      const record = await RefreshToken.findOneAndDelete({ tokenHash: hashToken(presented) });
      if (!record || record.expiresAt.getTime() < Date.now()) throw new HttpError(401, "Invalid refresh token");
      const user = await User.findOne({ _id: record.userId, tenantId: record.tenantId });
      if (!user) throw new HttpError(401, "Invalid refresh token");
      res.json({ accessToken: await issueSession(res, user) });
    }),
  );

  router.post(
    "/logout",
    asyncHandler(async (req, res) => {
      const presented = req.cookies?.[COOKIE] as string | undefined;
      if (presented) await RefreshToken.deleteOne({ tokenHash: hashToken(presented) });
      res.clearCookie(COOKIE, { path: "/api/auth" });
      res.status(204).end();
    }),
  );

  // Admin-only: add employees to the caller's own tenant.
  router.post(
    "/users",
    authenticate(env.JWT_ACCESS_SECRET),
    requirePermission("users:manage"),
    asyncHandler(async (req, res) => {
      const body = createUserBody.parse(req.body);
      const user = await User.create({
        tenantId: tenantOf(req),
        email: body.email,
        name: body.name,
        passwordHash: await bcrypt.hash(body.password, 12),
        role: body.role,
      });
      res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
    }),
  );

  return router;
}
