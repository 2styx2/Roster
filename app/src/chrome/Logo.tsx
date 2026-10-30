// The mark (Gap orbit, plain; decision Q57) for use inside the app: no tile, drawn with Theme
// tokens so it follows every Theme. The R, its orbit and the Box at the foot of the stem are the
// text colour (faded as in the masters); the one accent is the Host where the orbit breaks, the
// node the leg reaches. The app icon is the tiled version, rendered from assets/logo.svg and
// assets/logo-small.svg (app/scripts/icons.mjs).

interface Cut {
  viewBox: string;
  /** The orbit, open where the Host sits. */
  orbit: string;
  orbitWidth: number;
  /** The R and its leg, as one path so the fade is even where strokes meet. */
  edges: string;
  edgeWidth: number;
  /** The R's own nodes (none in the small cut) and their radius. */
  hosts: readonly (readonly [number, number])[];
  r: number;
  /** This Box: a square at the foot of the stem. */
  box: { x: number; size: number; rx: number };
  /** The Host on the orbit: a ring in the accent. */
  host: { r: number; width: number };
}

// The Host's centre: 50° round the orbit (r 26 about 32,32).
const HOST = [48.71, 51.92] as const;

/** 25 px and up (lock screen, empty states): the full R, five nodes and the leg. */
const FULL: Cut = {
  viewBox: "4 4 56 56",
  orbit: "M37.28 57.46A26 26 0 1 1 56.15 41.62",
  orbitWidth: 2.58,
  edges: "M22 18V46M22 18H35L41 25L35 32H22M35 32L44.86 46.33",
  edgeWidth: 4.3,
  hosts: [
    [22, 18],
    [22, 32],
    [35, 18],
    [41, 25],
    [35, 32],
  ],
  r: 5.2,
  box: { x: 16.9, size: 10.2, rx: 1.98 },
  host: { r: 6.28, width: 4.08 },
};

/** 24 px and under (the title bar): stem, bowl and leg, heavier, with a wider gap. */
const SMALL: Cut = {
  viewBox: "3 3 59 59",
  orbit: "M32.92 57.98A26 26 0 1 1 57.43 37.41",
  orbitWidth: 3.74,
  edges: "M22 46V18M22 18H32A8 8 0 0 1 32 34H22M31 34L42.74 45.87",
  edgeWidth: 5.2,
  hosts: [],
  r: 5.8,
  box: { x: 16.32, size: 11.36, rx: 2.2 },
  host: { r: 7.5, width: 4 },
};

export function Logo({ size = 16, className }: { size?: number; className?: string }) {
  const small = size <= 24;
  const c = small ? SMALL : FULL;
  return (
    <svg
      className={`logo${small ? " small" : ""}${className ? ` ${className}` : ""}`}
      viewBox={c.viewBox}
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path className="logo-orbit" d={c.orbit} fill="none" strokeWidth={c.orbitWidth} strokeLinecap="round" />
      <path className="logo-edges" d={c.edges} fill="none" strokeWidth={c.edgeWidth} strokeLinecap="round" strokeLinejoin="round" />
      {c.hosts.map(([x, y]) => (
        <circle key={`${x},${y}`} className="logo-node" cx={x} cy={y} r={c.r} />
      ))}
      <rect className="logo-node" x={c.box.x} y={46 - c.box.size / 2} width={c.box.size} height={c.box.size} rx={c.box.rx} />
      <circle className="logo-host" cx={HOST[0]} cy={HOST[1]} r={c.host.r} fill="none" strokeWidth={c.host.width} />
    </svg>
  );
}
