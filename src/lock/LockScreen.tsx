// The lock screen, and the gate that hides everything behind it. Sessions keep running under the
// gate (it never unmounts its children); while locked they're invisible, inert and out of the
// accessibility tree, and the lock screen covers the window.
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Vault, VaultView } from "./useVault";

const PROVIDER_NAMES: Record<string, string> = { bw: "Bitwarden" };
const providerName = (p: string) => PROVIDER_NAMES[p] ?? p;

/** roster's messages put commands in backticks: show those as code. */
function withCode(message: string): ReactNode[] {
  return message.split("`").map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

export function LockGate({
  vault,
  hint,
  children,
}: {
  vault: Vault;
  /** How to lock by hand, shown under the form (e.g. the Leader and the lock key). */
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="lock-gate" data-locked={vault.locked || undefined} inert={vault.locked} aria-hidden={vault.locked || undefined}>
        {children}
      </div>
      {vault.locked && <LockScreen vault={vault} hint={hint} />}
    </>
  );
}

function LockScreen({ vault, hint }: { vault: Vault; hint?: ReactNode }) {
  return (
    <div className="lock" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <section className="lock-panel">
        <h1 id="lock-title">Locked</h1>
        <Body view={vault.view} vault={vault} />
        {hint && <p className="lock-hint muted">{hint}</p>}
      </section>
    </div>
  );
}

function Body({ view, vault }: { view: VaultView; vault: Vault }) {
  switch (view.state) {
    case "checking":
      return <p className="muted">Checking the vault…</p>;
    case "locked":
      return <UnlockForm provider={view.provider} error={view.error} onUnlock={vault.unlock} />;
    case "unavailable":
    case "failed":
      return (
        <>
          <p role="alert" className="lock-problem">
            {withCode(view.message)}
          </p>
          <button type="button" onClick={() => void vault.check()} autoFocus>
            Check again
          </button>
        </>
      );
    default:
      return null;
  }
}

function UnlockForm({
  provider,
  error,
  onUnlock,
}: {
  provider: string;
  error: string | null;
  onUnlock: (password: string) => Promise<void>;
}) {
  // Uncontrolled on purpose: the password lives only in the input, never in React state.
  const field = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = field.current;
    if (!input || busy || input.value === "") return;
    setBusy(true);
    try {
      await onUnlock(input.value);
    } finally {
      input.value = "";
      setBusy(false);
      input.focus();
    }
  }

  return (
    <form className="lock-form" onSubmit={(e) => void submit(e)}>
      <p>Unlock {providerName(provider)} to continue.</p>
      <label htmlFor="lock-password">Master password</label>
      <div className="lock-row">
        <input
          id="lock-password"
          ref={field}
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          readOnly={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "lock-error" : undefined}
        />
        <button type="submit" disabled={busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </div>
      {error && (
        <p id="lock-error" role="alert" className="lock-error">
          {withCode(error)}
        </p>
      )}
    </form>
  );
}
