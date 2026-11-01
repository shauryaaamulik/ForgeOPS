import { useEffect, useState, type FormEvent } from "react";
import { io } from "socket.io-client";

type Status = "RUNNING" | "IDLE" | "DOWN";
interface Telemetry {
  machineId: string;
  status: Status;
  temperature?: number;
  rpm?: number;
  productionCount?: number;
  timestamp: string;
}
interface Session {
  accessToken: string;
  tenantId: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

function AuthForm({ onSession }: { onSession: (s: Session) => void }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    try {
      if (mode === "register") {
        const r = await post<{ accessToken: string; tenantId: string }>("/api/auth/register", {
          companyName: get("companyName"),
          name: get("name"),
          email: get("email"),
          password: get("password"),
        });
        onSession({ accessToken: r.accessToken, tenantId: r.tenantId });
      } else {
        const tenantId = get("tenantId");
        const r = await post<{ accessToken: string }>("/api/auth/login", { tenantId, email: get("email"), password: get("password") });
        onSession({ accessToken: r.accessToken, tenantId });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <form className="card" onSubmit={(e) => void submit(e)}>
      <h1>ForgeOps</h1>
      {mode === "register" ? (
        <>
          <input name="companyName" placeholder="Factory / company name" required />
          <input name="name" placeholder="Your name" required />
        </>
      ) : (
        <input name="tenantId" placeholder="Factory ID" required />
      )}
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password (min 8 characters)" minLength={8} required />
      {error && <p className="error">{error}</p>}
      <button type="submit">{mode === "register" ? "Create factory" : "Sign in"}</button>
      <button type="button" className="link" onClick={() => setMode(mode === "register" ? "login" : "register")}>
        {mode === "register" ? "Have an account? Sign in" : "New factory? Register"}
      </button>
    </form>
  );
}

function Dashboard({ session }: { session: Session }) {
  const [machines, setMachines] = useState<Record<string, Telemetry>>({});

  useEffect(() => {
    const socket = io({ auth: { token: session.accessToken } });
    socket.on("machine:telemetry", (t: Telemetry) => setMachines((prev) => ({ ...prev, [t.machineId]: t })));
    return () => {
      socket.disconnect();
    };
  }, [session.accessToken]);

  const list = Object.values(machines).sort((a, b) => a.machineId.localeCompare(b.machineId));
  return (
    <main>
      <header>
        <h1>Live machines</h1>
        <small>Factory ID: {session.tenantId}</small>
      </header>
      {list.length === 0 ? (
        <p>Waiting for telemetry. Start the simulator with <code>npm run simulate</code>.</p>
      ) : (
        <div className="grid">
          {list.map((m) => (
            <div key={m.machineId} className={`machine ${m.status.toLowerCase()}`}>
              <strong>{m.machineId}</strong>
              <span>{m.status}</span>
              <small>{m.rpm ?? 0} rpm · {m.temperature ?? "-"} °C · {m.productionCount ?? 0} parts</small>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  return session ? <Dashboard session={session} /> : <AuthForm onSession={setSession} />;
}
