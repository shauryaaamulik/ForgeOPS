# ForgeOps

A multi-tenant manufacturing execution and inventory platform for small and mid-sized factories: work orders, material reservations, live machine monitoring and OEE analytics.

> **Status: foundation.** This repository contains the first slice of the roadmap below. Items marked ✅ exist in code; the rest are planned.

## What exists today

| Area | Status | Where |
|---|---|---|
| Multi-tenant auth: register factory, login, rotating refresh tokens, admin-created users | ✅ | `server/src/modules/auth` |
| RBAC (`admin`, `manager`, `operator`, `viewer`) | ✅ | `server/src/modules/auth/rbac.ts` |
| Tenant isolation (tenant id comes from the verified JWT only) | ✅ | `server/src/middleware/auth.ts` |
| Inventory: materials, receipts, available vs reserved stock | ✅ | `server/src/modules/inventory` |
| Transactional stock reservation (no double allocation, all-or-nothing) | ✅ | `server/src/modules/inventory/service.ts` |
| Work orders with capacity check against machine rate and deadline | ✅ | `server/src/modules/production` |
| Machines, telemetry ingestion, live Socket.IO feed per tenant | ✅ | `server/src/modules/machines` |
| OEE calculation (pure function) | ✅ | `server/src/modules/analytics/oee.ts` |
| Machine simulator (12 machines by default) | ✅ | `simulator/` |
| Minimal React + TypeScript client (auth + live machine grid) | ✅ | `client/` |
| OEE/downtime persistence and charts, reports (PDF/CSV), notifications (Redis + BullMQ) | planned | |
| Tailwind + shadcn/ui, Swagger/OpenAPI, Playwright E2E, Dockerfiles, deployment | planned | |

## Architecture

A **modular monolith**: one Express app split into independent modules, not microservices.

```
forgeops/
├── client/       React + TypeScript (Vite)
├── server/       Express + TypeScript + Mongoose
│   └── src/modules/{auth,inventory,production,machines,analytics}
├── simulator/    fake machines posting telemetry
└── docker-compose.yml   MongoDB as a single-node replica set
```

Key design decisions:

- **MongoDB must run as a replica set.** Multi-document transactions are not available on a standalone `mongod`. `docker-compose.yml` starts a single-node replica set (`rs0`), and the integration tests use `MongoMemoryReplSet`.
- **Reservations are atomic.** A reservation is one `findOneAndUpdate` whose filter only matches when `onHand - reserved >= quantity`, inside a transaction that also writes the reservation record. Concurrent orders cannot both claim the same stock, and a failed second material rolls back the first.
- **Tenancy.** Every collection carries `tenantId`, every query is scoped by it, and compound indexes start with `tenantId`. The tenant is read from the access token, never from the request body. Socket.IO connections join only their own `tenant:<id>` room.
- **Auth.** Short-lived access JWT (15 min) plus a single-use rotating refresh token in an `httpOnly` cookie; only its SHA-256 hash is stored.
- **OEE** = Availability × Performance × Quality, where Availability = run time / planned time, Performance = (ideal cycle time × total count) / run time (capped at 1), Quality = good / total.

## Run locally

Requires Node 20+ and Docker.

```bash
docker compose up -d                 # MongoDB replica set
cp .env.example server/.env          # then set real JWT secrets
npm install
npm run dev:server                   # http://localhost:4000
npm run dev:client                   # http://localhost:5173
```

Register a factory in the UI, note the Factory ID shown on the dashboard, then:

```bash
FORGEOPS_TENANT_ID=<factory id> FORGEOPS_EMAIL=<your email> FORGEOPS_PASSWORD=<your password> npm run simulate
```

Tests: `npm test` (unit tests plus integration tests against an in-memory replica set; the first run downloads a `mongod` binary).

## Verification status

Be aware of what has and has not been run:

- **Verified:** the pure logic (OEE, RBAC, stock arithmetic, capacity check) was executed and its assertions passed.
- **Not yet run by the author of this scaffold:** `npm install`, type-checking, the Vitest suites (including the transaction/concurrency integration tests), and the client build. The package versions are caret ranges that were not checked against the registry. The GitHub Actions workflow in `.github/workflows/ci.yml` runs all of these on every push; **check that run first and fix anything it reports.** Once green, commit `package-lock.json` and switch the workflow from `npm install` to `npm ci`.

## Roadmap

| Phase | Weeks | Deliverables |
|---|---|---|
| 1. Foundation (this repo) | 2 | Modular monolith, auth, tenancy, inventory, work orders, live feed |
| 2. Hardening | 1–2 | Green CI, lockfile, input edge cases, pagination, audit log |
| 3. Analytics | 1–2 | Persist telemetry, downtime events, OEE per machine/shift, Recharts dashboards |
| 4. UI | 2 | React Router, work-order and inventory screens, Tailwind + shadcn/ui |
| 5. Background jobs | 1–2 | Redis + BullMQ: low-stock and late-order alerts, CSV/PDF reports |
| 6. Production readiness | 2 | OpenAPI docs, Playwright E2E, Dockerfiles, deployment, benchmarks |

Only quote performance numbers on a résumé after benchmarking this application yourself.
