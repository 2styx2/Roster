// The real Backend: Tauri commands in src-tauri/src/lib.rs, which drive `roster serve` through
// desk-core. Only imported when running inside Tauri (see index.ts).
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  BackendCallError,
  BackendStartError,
  type Backend,
  type BackendInfo,
  type BackendProblem,
  type Host,
  type HostList,
  type ProviderStatus,
  type VaultStatus,
  type SessionAuth,
  type SessionEvents,
  type SessionExit,
  type SessionHandle,
  type TermSize,
} from "./types";

/** desk-core's CallError, as serde sends it. */
type CallErrorWire =
  | { kind: "rpc"; code: number; message: string }
  | { kind: "exited"; code: number | null; stderr: string }
  | { kind: "timeout" }
  | { kind: "io"; message: string };

function isProblem(e: unknown): e is BackendProblem {
  return typeof e === "object" && e !== null && "hint" in e && "message" in e && "kind" in e;
}

function callError(e: unknown): BackendCallError {
  if (typeof e === "object" && e !== null && "kind" in e) {
    const w = e as CallErrorWire;
    switch (w.kind) {
      case "rpc":
        return new BackendCallError(w.message, w.code);
      case "exited":
        return new BackendCallError(`The backend exited (code ${w.code ?? "?"}). ${w.stderr}`.trim());
      case "timeout":
        return new BackendCallError("The backend didn't answer in time.");
      case "io":
        return new BackendCallError(w.message);
    }
  }
  return new BackendCallError(String(e));
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw callError(e);
  }
}

/** One Session's channel: raw output bytes (an ArrayBuffer), then `{exit}` as JSON. */
type SessionMessage = ArrayBuffer | Uint8Array | number[] | { exit: SessionExit };

function sessionChannel(events: SessionEvents): Channel<SessionMessage> {
  const ch = new Channel<SessionMessage>();
  ch.onmessage = (m) => {
    if (m instanceof ArrayBuffer) events.output(new Uint8Array(m));
    else if (m instanceof Uint8Array) events.output(m);
    else if (Array.isArray(m)) events.output(Uint8Array.from(m));
    else events.exit(m.exit);
  };
  return ch;
}

async function openSession(host: string, size: TermSize, events: SessionEvents): Promise<SessionHandle> {
  const { id, auth } = await call<{ id: number; auth: SessionAuth }>("session_open", {
    host,
    cols: size.cols,
    rows: size.rows,
    events: sessionChannel(events),
  });
  return {
    id,
    auth,
    write: (data) => call("session_write", { id, data }),
    resize: ({ cols, rows }) => call("session_resize", { id, cols, rows }),
    close: () => call("session_close", { id }),
  };
}

export function tauriBackend(): Backend {
  return {
    async connect(options) {
      try {
        return await invoke<BackendInfo>("backend_connect", { restart: options?.restart ?? false });
      } catch (e) {
        if (isProblem(e)) throw new BackendStartError(e);
        throw callError(e);
      }
    },
    listHosts: () => call<HostList>("hosts_list"),
    getHost: (name) => call<Host>("host_get", { name }),
    vaultStatus: () => call<VaultStatus>("vault_status"),
    unlockVault: (password) => call<ProviderStatus>("vault_unlock", { password }),
    lockVault: () => call<{ locked: string[] }>("vault_lock"),
    openSession,
  };
}
