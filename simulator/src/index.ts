/**
 * Machine simulator: logs in as an operator-capable user and posts telemetry
 * for N fake machines. Usage:
 *   FORGEOPS_TENANT_ID=... FORGEOPS_EMAIL=... FORGEOPS_PASSWORD=... npm run simulate
 * The user needs the "telemetry:ingest" and "machines:write" permissions (admin has both).
 */
const base = process.env.FORGEOPS_URL ?? "http://localhost:4000";
const tenantId = process.env.FORGEOPS_TENANT_ID;
const email = process.env.FORGEOPS_EMAIL;
const password = process.env.FORGEOPS_PASSWORD;
const machineCount = Number(process.env.MACHINES ?? 12);
const intervalMs = Number(process.env.INTERVAL_MS ?? 2000);

if (!tenantId || !email || !password) {
  console.error("Set FORGEOPS_TENANT_ID, FORGEOPS_EMAIL and FORGEOPS_PASSWORD.");
  process.exit(1);
}

type Status = "RUNNING" | "IDLE" | "DOWN";
interface SimMachine {
  code: string;
  status: Status;
  count: number;
}

async function api(path: string, token: string | null, body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function nextStatus(s: Status): Status {
  const r = Math.random();
  if (s === "RUNNING") return r < 0.03 ? "DOWN" : r < 0.06 ? "IDLE" : "RUNNING";
  if (s === "DOWN") return r < 0.25 ? "IDLE" : "DOWN";
  return r < 0.4 ? "RUNNING" : "IDLE";
}

async function main(): Promise<void> {
  const login = await api("/api/auth/login", null, { tenantId, email, password });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  const { accessToken } = (await login.json()) as { accessToken: string };

  const machines: SimMachine[] = Array.from({ length: machineCount }, (_, i) => ({
    code: `CNC-${String(i + 1).padStart(3, "0")}`,
    status: "IDLE",
    count: 0,
  }));

  for (const m of machines) {
    const res = await api("/api/machines", accessToken, { code: m.code, name: `Simulated ${m.code}`, ratedUnitsPerHour: 60 });
    if (!res.ok && res.status !== 409) throw new Error(`Could not create ${m.code}: ${res.status}`);
  }
  console.log(`Simulating ${machines.length} machines every ${intervalMs}ms. Ctrl+C to stop.`);

  setInterval(() => {
    for (const m of machines) {
      m.status = nextStatus(m.status);
      if (m.status === "RUNNING") m.count += Math.floor(Math.random() * 3) + 1;
      const running = m.status === "RUNNING";
      void api(`/api/machines/${m.code}/telemetry`, accessToken, {
        status: m.status,
        temperature: Number((running ? 55 + Math.random() * 25 : 25 + Math.random() * 5).toFixed(1)),
        rpm: running ? Math.round(2000 + Math.random() * 800) : 0,
        productionCount: m.count,
        timestamp: new Date().toISOString(),
      }).catch((e: unknown) => console.error(m.code, e));
    }
  }, intervalMs);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
