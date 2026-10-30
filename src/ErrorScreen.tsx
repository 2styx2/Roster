import type { BackendProblem, BackendProblemKind } from "./backend/types";

const HEADINGS: Record<BackendProblemKind, string> = {
  "no-wsl": "No WSL distro",
  "roster-missing": "roster wasn't found",
  "roster-too-old": "roster is too old",
  "inventory-not-found": "No Inventory",
  failed: "The backend didn't start",
};

export function ErrorScreen({ problem, onRetry }: { problem: BackendProblem; onRetry: () => void }) {
  return (
    <div className="screen center">
      <section className="error" aria-live="polite">
        <h1>{HEADINGS[problem.kind]}</h1>
        <p>{problem.message}</p>
        <p className="hint">{problem.hint}</p>
        {problem.detail && <pre className="detail">{problem.detail}</pre>}
        <button type="button" className="primary" onClick={onRetry} autoFocus>
          Retry
        </button>
      </section>
    </div>
  );
}
