// The Lock's state (GLOSSARY: Lock). The app is locked until `vault.unlock` succeeds, and locks
// again on demand or after `idleMs` without input. Unlocking the vault is what unlocks the app:
// there is no app password. A vault with no master password (`unsupported`) means no lock screen.
import { useCallback, useEffect, useRef, useState } from "react";
import { BackendCallError, VaultError, type Backend, type VaultStatus } from "../backend/types";
import { idleTimer, realClock, type Clock } from "./idle";

export type VaultView =
  /** Asking `vault.status` (the lock screen is up meanwhile). */
  | { state: "checking" }
  | { state: "locked"; provider: string; error: string | null }
  /** The vault CLI can't unlock on this box yet; `message` says what to run or install. */
  | { state: "unavailable"; provider: string; message: string }
  /** `vault.status` itself failed. */
  | { state: "failed"; message: string }
  | { state: "unlocked"; provider: string }
  /** No Host Login uses a vault with a master password: nothing to lock. */
  | { state: "none" };

export interface Vault {
  view: VaultView;
  /** True while the lock screen is up and the Sessions are hidden. */
  locked: boolean;
  /** Ask the vault where it stands again (the lock screen's "Check again"). */
  check(): Promise<void>;
  unlock(password: string): Promise<void>;
  /** Lock now. False if there's nothing to lock. */
  lock(): boolean;
}

const INPUT_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel"] as const;

function viewOf(s: VaultStatus): VaultView {
  if (s.provider === null || s.status === "unsupported") return { state: "none" };
  if (s.status === "unlocked") return { state: "unlocked", provider: s.provider };
  if (s.status === "locked") return { state: "locked", provider: s.provider, error: null };
  return { state: "unavailable", provider: s.provider, message: s.message ?? `${s.provider}: ${s.status}` };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useVault(
  backend: Backend,
  active: boolean,
  { idleMs, clock = realClock }: { idleMs: number; clock?: Clock | undefined },
): Vault {
  const [view, setView] = useState<VaultView>({ state: "checking" });
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const check = useCallback(async () => {
    setView({ state: "checking" });
    try {
      let s = await backend.vaultStatus();
      // The app always opens locked, even on a serve that's still unlocked (a reloaded window).
      if (s.status === "unlocked") {
        await backend.lockVault();
        s = { ...s, status: "locked" };
      }
      setView(viewOf(s));
    } catch (e) {
      setView({ state: "failed", message: messageOf(e) });
    }
  }, [backend]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- asking the vault is the effect
    if (active) void check();
  }, [active, check]);

  const unlock = useCallback(
    async (password: string) => {
      const v = viewRef.current;
      if (v.state !== "locked") return;
      try {
        const r = await backend.unlockVault(password);
        setView({ state: "unlocked", provider: r.provider });
      } catch (e) {
        const code = e instanceof BackendCallError ? e.code : null;
        if (code === VaultError.wrongPassword) {
          setView({ ...v, error: "Wrong master password. Try again." });
        } else if (code === VaultError.notLoggedIn || code === VaultError.cliMissing) {
          setView({ state: "unavailable", provider: v.provider, message: messageOf(e) });
        } else if (code === VaultError.unsupported) {
          setView({ state: "none" });
        } else {
          setView({ ...v, error: messageOf(e) });
        }
      }
    },
    [backend],
  );

  const lock = useCallback((): boolean => {
    const v = viewRef.current;
    if (v.state === "none") return false;
    // Hide first, then forget: the Sessions are covered before the call goes out.
    if (v.state === "unlocked") setView({ state: "locked", provider: v.provider, error: null });
    backend.lockVault().catch((e: unknown) => {
      setView((cur) => (cur.state === "locked" ? { ...cur, error: `Locking the vault failed: ${messageOf(e)}` } : cur));
    });
    return true;
  }, [backend]);

  // The idle lock: any input anywhere in the window counts, captured before anything can stop it.
  const unlocked = view.state === "unlocked";
  useEffect(() => {
    if (!unlocked) return;
    const timer = idleTimer({ timeoutMs: idleMs, clock, onIdle: () => lock() });
    const onInput = () => timer.activity();
    timer.start();
    for (const ev of INPUT_EVENTS) window.addEventListener(ev, onInput, { capture: true, passive: true });
    return () => {
      timer.stop();
      for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput, { capture: true });
    };
  }, [unlocked, idleMs, clock, lock]);

  const locked = view.state !== "unlocked" && view.state !== "none";
  return { view, locked, check, unlock, lock };
}
