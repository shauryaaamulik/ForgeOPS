import { createServer } from "node:http";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { verifyAccessToken } from "./modules/auth/tokens.js";

const env = loadEnv();

// The Socket.IO server is created first so the HTTP routes can publish to it.
const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: env.CLIENT_ORIGIN, credentials: true } });

// Each connection joins only its own tenant's room, so live data never crosses tenants.
io.use((socket, next) => {
  try {
    const token = String(socket.handshake.auth?.token ?? "");
    const claims = verifyAccessToken(token, env.JWT_ACCESS_SECRET);
    socket.data.tenantId = claims.tenantId;
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});
io.on("connection", (socket) => {
  void socket.join(`tenant:${socket.data.tenantId}`);
});

const app = createApp(env, (tenantId, event, payload) => {
  io.to(`tenant:${tenantId}`).emit(event, payload);
});
httpServer.on("request", app);

await mongoose.connect(env.MONGO_URI);
httpServer.listen(env.PORT, () => {
  console.log(`ForgeOps server listening on :${env.PORT}`);
});
