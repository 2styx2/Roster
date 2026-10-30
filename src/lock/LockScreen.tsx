// The lock screen, and the gate that hides everything behind it. Sessions keep running under the
// gate (it never unmounts its children); while locked they're invisible, inert and out of the
// accessibility tree, and the lock screen covers the window.
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Logo } from "../chrome/Logo";
import type { ErrorRow } from "../errors/catalog";
import { SignIn } from "./SignIn";
import type { Vault, VaultView } from "./useVault";
import { withCode } from "./withCode";

const PROVIDER_NAMES: Record<string, string> = { bw: "Bitwarden" };
const providerName = (p: string) => PROVIDER_NAMES[p] ?? p;

/** What the sign-in needs from the app: the errors catalog's rows and the clipboard. */
interface LockExtras {
  errorRows?: readonly ErrorRow[] | undefined;
  copy?: ((text: string) => Promise<void>) | undefined;
}

export function LockGate({
  vault,
  hint,
  children,
  errorRows,
  copy,
}: {
  vault: Vault;
  /** How to lock by hand, shown under the form (e.g. the Leader and the lock key). */
  hint?: ReactNode;
  children: ReactNode;
} & LockExtras) {
  return (
    <>
      <div className="lock-gate" data-locked={vault.locked || undefined} inert={vault.locked} aria-hidden={vault.locked || undefined}>
        {children}
      </div>
      {vault.locked && <LockScreen vault={vault} hint={hint} errorRows={errorRows} copy={copy} />}
    </>
  );
}

function LockScreen({ vault, hint, errorRows, copy }: { vault: Vault; hint?: ReactNode } & LockExtras) {
  const signingIn = vault.view.state === "signin";
  return (
    <div className="lock" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <section className="lock-panel">
        <Logo size={32} className="lock-mark" />
        <h1 id="lock-title">{signingIn ? "Sign in to Bitwarden" : "Locked"}</h1>
        {vault.view.state === "signin" ? (
          <SignIn vault={vault} info={vault.view.info} errorRows={errorRows} copy={copy} />
        ) : (
          <Body view={vault.view} vault={vault} />
        )}
        {hint && !signingIn && <p className="lock-hint muted">{hint}</p>}
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
        <button type="submit" className="primary" disabled={busy}>
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
