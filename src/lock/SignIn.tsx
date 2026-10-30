// Signing the vault CLI in from the lock screen (ticket 31, decision Q52), for a Box whose CLI isn't
// logged in yet. The steps follow roster's `vault.login` (roster README "Signing in"):
//   server -> email -> master password -> [two-step method] -> [code] -> [new-device code]
// with an API key or SSO as the other ways in from the first screen (both end with the master
// password, since they only log in). Keyboard-first: Tab and Enter, and Esc goes back a step.
//
// Secrets (the master password, codes, the API secret) live only in their inputs, never in React
// state; every input in the form is emptied as soon as the call it fed returns. Errors are rendered
// from the errors catalog (docs/errors.md rows 22-33), keyed by roster's code.
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  BackendCallError,
  SignInError,
  VaultError,
  type SignInInfo,
  type SignInStart,
  type SignInStep,
  type TwoFactorMethod,
} from "../backend/types";
import { builtinErrorRows, fixFor, problemFromCallError, rowFor, sentence, type ErrorRow } from "../errors/catalog";
import type { Problem } from "../errors/classify";
import type { Vault } from "./useVault";
import { withCode } from "./withCode";
import "./signin.css";

type Way = SignInStart["method"];
type ServerChoice = "cloud" | "eu" | "self";
type Asked = Exclude<SignInStep, { step: "done" }>;

/** Where the person is: one of the app's own screens, or a step roster asked for. */
type Screen =
  | { kind: "server" }
  | { kind: "email" }
  | { kind: "password" }
  | { kind: "apikey" }
  | { kind: "sso" }
  | { kind: "step"; step: Asked; via: Way };

const EU = "https://vault.bitwarden.eu";
const CLOUD = ["https://bitwarden.com", "https://vault.bitwarden.com"];

function presetServer(server: string | null): { choice: ServerChoice; url: string } {
  const s = server?.replace(/\/+$/, "") ?? null;
  if (s === null || CLOUD.includes(s)) return { choice: "cloud", url: "" };
  if (s === EU) return { choice: "eu", url: "" };
  return { choice: "self", url: s };
}

/** The screen a sign-in started from: Esc and a failure that ends the sign-in go back there. */
const origin = (via: Way): Screen => ({ kind: via });

const SERVER_LABEL: Record<ServerChoice, string> = {
  cloud: "Bitwarden cloud (bitwarden.com)",
  eu: "Bitwarden EU (bitwarden.eu)",
  self: "Self-hosted",
};

function codeHint(step: Extract<Asked, { step: "two_factor_code" }>, email: string): string {
  switch (step.method?.kind) {
    case "authenticator":
      return "Type the 6-digit code from your authenticator app.";
    case "email":
      return step.sent ? `Bitwarden emailed a code to ${email || "your account's email"}.` : "Type the code Bitwarden emailed you.";
    case "yubikey":
      return "Touch your YubiKey: it types its code here.";
    default:
      return "Type the code from your two-step login: your authenticator app, the email Bitwarden sent, or your YubiKey.";
  }
}

export function SignIn({
  vault,
  info,
  errorRows = builtinErrorRows,
  copy,
}: {
  vault: Vault;
  info: SignInInfo;
  errorRows?: readonly ErrorRow[] | undefined;
  /** Puts text on the clipboard (the SSO link). */
  copy?: ((text: string) => Promise<void>) | undefined;
}) {
  const preset = presetServer(info.server);
  const [choice, setChoice] = useState<ServerChoice>(preset.choice);
  const [url, setUrl] = useState(preset.url); // a server address: not a secret
  const [email, setEmail] = useState(""); // not a secret: kept for Esc back and the new-device text
  const [screen, setScreen] = useState<Screen>({ kind: "server" });
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const server = choice === "self" ? url.trim() : choice;
  const ways = new Set(info.methods);

  // Each screen (and each error on it) puts the focus on its first field.
  useEffect(() => {
    form.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [screen, problem]);

  /** Empties every typed field: secrets never outlive the call they were typed for. */
  const clearFields = () => {
    form.current?.querySelectorAll<HTMLInputElement>("input[data-secret]").forEach((i) => (i.value = ""));
  };
  const value = (name: string) => form.current?.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? "";

  const failed = useCallback(
    (e: unknown, via: Way) => {
      const p = problemFromCallError("Bitwarden", e);
      setProblem(p);
      const data = e instanceof BackendCallError ? e.data : null;
      const again = data?.step as Asked | undefined;
      if (again && typeof data?.login === "string") return setScreen({ kind: "step", step: { ...again, login: data.login }, via });
      const code = e instanceof BackendCallError ? e.code : null;
      if (code === SignInError.alreadyLoggedIn) return void vault.check();
      if (code === SignInError.badServer || code === SignInError.serverUnreachable) return setScreen({ kind: "server" });
      setScreen(origin(via));
    },
    [vault],
  );

  /** roster asked for the next step (a `done` has already unlocked the app). */
  const advanced = useCallback((step: SignInStep, via: Way) => {
    setProblem(null);
    if (step.step !== "done") setScreen({ kind: "step", step, via });
  }, []);

  const run = useCallback(
    async (call: () => Promise<SignInStep>, via: Way) => {
      setBusy(true);
      try {
        advanced(await call(), via);
      } catch (e) {
        failed(e, via);
      } finally {
        clearFields();
        setBusy(false);
      }
    },
    [advanced, failed],
  );

  function next(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    switch (screen.kind) {
      case "server":
        if (choice === "self" && !url.trim()) return;
        setProblem(null);
        return setScreen({ kind: "email" });
      case "email":
        if (!email.trim()) return;
        return setScreen({ kind: "password" });
      case "password": {
        const password = value("password");
        if (!password) return;
        return void run(() => vault.signInStart({ method: "password", server, email: email.trim(), password }), "password");
      }
      case "apikey": {
        const id = value("client_id").trim();
        const secret = value("client_secret");
        if (!id || !secret) return;
        return void run(() => vault.signInStart({ method: "apikey", server, client_id: id, client_secret: secret }), "apikey");
      }
      case "sso": {
        const identifier = value("identifier").trim();
        return void run(() => vault.signInStart({ method: "sso", server, ...(identifier ? { identifier } : {}) }), "sso");
      }
      case "step": {
        const { step, via } = screen;
        if (step.step === "two_factor_code" || step.step === "new_device_code") {
          const code = value("code").trim();
          if (!code) return;
          return void run(() => vault.signInAnswer(step.login, { code }), via);
        }
        if (step.step === "master_password") {
          const password = value("password");
          if (!password) return;
          return void run(() => vault.signInAnswer(step.login, { password }), via);
        }
      }
    }
  }

  function back() {
    if (busy) return;
    clearFields();
    setProblem(null);
    switch (screen.kind) {
      case "email":
      case "apikey":
      case "sso":
        return setScreen({ kind: "server" });
      case "password":
        return setScreen({ kind: "email" });
      case "step":
        void vault.signInCancel();
        return setScreen(origin(screen.via));
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      back();
    } else if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type === "radio") {
      e.preventDefault(); // Enter on a server choice goes on, as it does in a text field
      next();
    }
  }

  const pick = (m: TwoFactorMethod) => {
    if (screen.kind !== "step" || busy) return;
    const { step, via } = screen;
    void run(() => vault.signInAnswer(step.login, { method: m.index }), via);
  };

  return (
    <form ref={form} className="lock-form signin" onSubmit={next} onKeyDown={onKeyDown} aria-busy={busy || undefined}>
      <Body
        screen={screen}
        choice={choice}
        setChoice={setChoice}
        url={url}
        setUrl={setUrl}
        email={email}
        setEmail={setEmail}
        busy={busy}
        ways={ways}
        go={(s) => {
          setProblem(null);
          setScreen(s);
        }}
        pick={pick}
        vault={vault}
        failed={failed}
        advanced={advanced}
        copy={copy}
        invalid={problem !== null}
      />
      {problem && <SignInProblem problem={problem} rows={errorRows} />}
      <p className="signin-keys muted">
        <kbd>Enter</kbd> continues{screen.kind !== "server" && <> · <kbd>Esc</kbd> goes back</>}
      </p>
    </form>
  );
}

interface BodyProps {
  screen: Screen;
  choice: ServerChoice;
  setChoice(c: ServerChoice): void;
  url: string;
  setUrl(u: string): void;
  email: string;
  setEmail(e: string): void;
  busy: boolean;
  ways: Set<Way>;
  go(s: Screen): void;
  pick(m: TwoFactorMethod): void;
  vault: Vault;
  failed(e: unknown, via: Way): void;
  advanced(step: SignInStep, via: Way): void;
  copy?: ((text: string) => Promise<void>) | undefined;
  /** Bitwarden refused what was typed: the field says so (aria-invalid), described by the error. */
  invalid: boolean;
}

/** A field's attributes while the sign-in shows an error, and none without one. */
const refused = (invalid: boolean) => (invalid ? { "aria-invalid": true, "aria-describedby": "signin-error" } : {});

function Submit({ busy, label = "Continue" }: { busy: boolean; label?: string }) {
  return (
    <button type="submit" className="primary" disabled={busy}>
      {busy ? "Working…" : label}
    </button>
  );
}

/** A secret field: uncontrolled (never in React state), emptied after every call. */
function Secret({ name, label, autoComplete = "off", inputMode, busy, invalid }: {
  name: string;
  label: string;
  autoComplete?: string;
  inputMode?: "numeric" | "text";
  busy: boolean;
  invalid: boolean;
}) {
  const id = `signin-${name}`;
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="lock-row">
        <input
          id={id}
          name={name}
          type={name === "code" ? "text" : "password"}
          autoComplete={autoComplete}
          inputMode={inputMode}
          spellCheck={false}
          readOnly={busy}
          data-secret
          data-autofocus
          {...refused(invalid)}
        />
        <Submit busy={busy} />
      </div>
    </>
  );
}

function Body(p: BodyProps) {
  const { screen, busy } = p;
  switch (screen.kind) {
    case "server":
      return (
        <>
          <p>This Box's Bitwarden CLI isn't signed in yet. Sign in once here; after that, unlocking takes just the master password.</p>
          <fieldset className="signin-servers">
            <legend>Server</legend>
            {(["cloud", "eu", "self"] as const).map((c) => (
              <label key={c} className="signin-choice">
                <input
                  type="radio"
                  name="server"
                  value={c}
                  checked={p.choice === c}
                  onChange={() => p.setChoice(c)}
                  {...(p.choice === c ? { "data-autofocus": true } : {})}
                />
                {SERVER_LABEL[c]}
              </label>
            ))}
          </fieldset>
          {p.choice === "self" && (
            <>
              <label htmlFor="signin-url">Server address</label>
              <input
                id="signin-url"
                type="text"
                inputMode="url"
                placeholder="https://vault.example.com"
                value={p.url}
                onChange={(e) => p.setUrl(e.target.value)}
                spellCheck={false}
              />
            </>
          )}
          <div className="signin-actions">
            <Submit busy={busy} label="Continue with email" />
            {p.ways.has("apikey") && (
              <button type="button" onClick={() => p.go({ kind: "apikey" })}>
                Use an API key
              </button>
            )}
            {p.ways.has("sso") && (
              <button type="button" onClick={() => p.go({ kind: "sso" })}>
                Use SSO
              </button>
            )}
          </div>
        </>
      );
    case "email":
      return (
        <>
          <label htmlFor="signin-email">Email</label>
          <div className="lock-row">
            <input
              id="signin-email"
              name="email"
              type="email"
              autoComplete="username"
              spellCheck={false}
              value={p.email}
              onChange={(e) => p.setEmail(e.target.value)}
              data-autofocus
              {...refused(p.invalid)}
            />
            <Submit busy={busy} />
          </div>
        </>
      );
    case "password":
      return (
        <>
          <p className="muted">{p.email}</p>
          <Secret name="password" label="Master password" busy={busy} invalid={p.invalid} />
        </>
      );
    case "apikey":
      return (
        <>
          <p>
            Your personal API key, from the web vault: Account settings, Security, Keys. It skips two-step login; the vault
            then needs your master password.
          </p>
          <label htmlFor="signin-client_id">client_id</label>
          <input id="signin-client_id" name="client_id" spellCheck={false} autoComplete="off" data-secret data-autofocus />
          <Secret name="client_secret" label="client_secret" busy={busy} invalid={p.invalid} />
        </>
      );
    case "sso":
      return (
        <>
          <p>Sign in through your organization's identity provider, in your browser.</p>
          <label htmlFor="signin-identifier">Organization identifier (optional)</label>
          <div className="lock-row">
            <input id="signin-identifier" name="identifier" spellCheck={false} autoComplete="off" data-secret data-autofocus />
            <Submit busy={busy} label="Open the browser" />
          </div>
        </>
      );
    case "step":
      return <Step {...p} step={screen.step} via={screen.via} />;
  }
}

function Step(p: BodyProps & { step: Asked; via: Way }) {
  const { step, busy } = p;
  switch (step.step) {
    case "two_factor_method":
      return <MethodPicker methods={step.methods} busy={busy} pick={p.pick} />;
    case "two_factor_code":
      return (
        <>
          <p>{codeHint(step, p.email)}</p>
          <Secret
            name="code"
            label={step.method ? `${step.method.name} code` : "Two-step code"}
            autoComplete="one-time-code"
            inputMode={step.method?.kind === "yubikey" ? "text" : "numeric"}
            busy={busy}
            invalid={p.invalid}
          />
        </>
      );
    case "new_device_code":
      return (
        <>
          <p>
            Bitwarden emailed a code to {step.email ?? (p.email || "your account's email")} because this Box hasn't signed in
            before.
          </p>
          <Secret
            name="code"
            label="New-device code"
            autoComplete="one-time-code"
            inputMode="numeric"
            busy={busy}
            invalid={p.invalid}
          />
        </>
      );
    case "sso":
      return <SsoWait step={step} via={p.via} vault={p.vault} failed={p.failed} advanced={p.advanced} copy={p.copy} />;
    case "master_password":
      return (
        <>
          <p>Signed in. Now unlock the vault with your master password.</p>
          <Secret name="password" label="Master password" busy={busy} invalid={p.invalid} />
        </>
      );
  }
}

function MethodPicker({ methods, busy, pick }: { methods: TwoFactorMethod[]; busy: boolean; pick(m: TwoFactorMethod): void }) {
  const list = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= methods.length) {
      e.preventDefault();
      const m = methods[n - 1];
      if (m) pick(m);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const to = (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[to]?.focus();
    }
  };
  return (
    <>
      <p>Your account has more than one two-step login method. Which one?</p>
      <div ref={list} role="group" aria-label="Two-step method" className="signin-methods" onKeyDown={move}>
        {methods.map((m, i) => (
          <button
            key={m.index}
            type="button"
            disabled={busy}
            onClick={() => pick(m)}
            {...(i === 0 ? { "data-autofocus": true } : {})}
          >
            <kbd>{i + 1}</kbd> {m.name}
          </button>
        ))}
      </div>
    </>
  );
}

/** SSO: show the link, and keep asking roster (it waits up to 20 s a call) until the browser is done. */
function SsoWait({
  step,
  via,
  vault,
  failed,
  advanced,
  copy,
}: {
  step: Extract<Asked, { step: "sso" }>;
  via: Way;
  vault: Vault;
  failed(e: unknown, via: Way): void;
  advanced(step: SignInStep, via: Way): void;
  copy?: ((text: string) => Promise<void>) | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const { login } = step;
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        let s: SignInStep;
        do {
          s = await vault.signInAnswer(login, {});
          if (!alive) return;
        } while (s.step === "sso");
        advanced(s, via);
      } catch (e) {
        if (alive) failed(e, via);
      }
    })();
    return () => {
      alive = false;
    };
  }, [login, vault, failed, advanced, via]);
  return (
    <div>
      <p aria-live="polite">Finish signing in in your browser. roster opened the page on this Box; if it didn't, open this link:</p>
      <p className="signin-link">
        <code>{step.url}</code>
      </p>
      {copy && (
        <button type="button" data-autofocus onClick={() => void copy(step.url).then(() => setCopied(true), () => {})}>
          {copied ? "Copied" : "Copy link"}
        </button>
      )}
      <p className="muted">Waiting for the browser… (up to {Math.round(step.expires_in / 60)} minutes)</p>
    </div>
  );
}

function SignInProblem({ problem, rows }: { problem: Problem; rows: readonly ErrorRow[] }) {
  const row = rowFor(rows, problem.code);
  const wrong = problem.code === VaultError.wrongPassword;
  return (
    <div id="signin-error" role="alert" className="signin-problem">
      <p className="lock-error">{withCode(sentence(problem.message))}</p>
      <dl className="signin-facts">
        <dt>Where</dt>
        <dd>{row.where.join(", ")}</dd>
        <dt>Fix</dt>
        <dd>{withCode(fixFor(row, problem))}</dd>
      </dl>
      {!wrong && problem.details && (
        <details>
          <summary>Details</summary>
          <pre>{problem.details}</pre>
        </details>
      )}
    </div>
  );
}
