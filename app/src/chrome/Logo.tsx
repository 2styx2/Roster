// The mark (logo D1, "Network R", decision Q29) for use inside the app: no tile, drawn in the
// Theme's text colour with the accent node, so it follows every Theme. The app icon is the tiled
// version, rendered from assets/logo.svg (app/scripts/icons.mjs).

const NODES = [
  [20, 14],
  [20, 32],
  [20, 50],
  [38, 14],
  [45, 23],
  [38, 32],
  [46, 50],
] as const;
const EDGES = [
  [0, 1],
  [1, 2],
  [0, 3],
  [3, 4],
  [4, 5],
  [5, 1],
  [5, 6],
] as const;

export function Logo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={`logo${className ? ` ${className}` : ""}`} viewBox="11 8 42 48" width={size} height={size} aria-hidden="true">
      <g className="logo-edges" strokeWidth="3.4" strokeLinecap="round">
        {EDGES.map(([a, b]) => (
          <line key={`${a}-${b}`} x1={NODES[a][0]} y1={NODES[a][1]} x2={NODES[b][0]} y2={NODES[b][1]} />
        ))}
      </g>
      {NODES.map(([x, y], i) => (
        <circle key={i} className={i === NODES.length - 1 ? "logo-target" : "logo-node"} cx={x} cy={y} r={i === NODES.length - 1 ? 6 : 4.6} />
      ))}
    </svg>
  );
}
