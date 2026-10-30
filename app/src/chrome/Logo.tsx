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
  box: { x: number; y: number; size: number; rx: number };
  /** The Host on the orbit: a ring in the accent. */
  host: { cx: number; cy: number; r: number; width: number };
}

/** 25 px and up (lock screen, empty states): the full R, five nodes and the leg, inside an orbit
 * of radius 28 with the Host at 50°. */
const FULL: Cut = {
  viewBox: "3 3 59 59",
  orbit: "M38.72 59.18A28 28 0 1 1 57.6 43.34",
  orbitWidth: 2.58,
  edges: "M22.57 18.84V45.16M22.57 18.84H34.79L40.43 25.42L34.79 32H22.57M34.79 32L46.08 47.92",
  edgeWidth: 4.3,
  hosts: [
    [22.57, 18.84],
    [22.57, 32],
    [34.79, 18.84],
    [40.43, 25.42],
    [34.79, 32],
  ],
  r: 5.2,
  box: { x: 17.89, y: 40.48, size: 9.36, rx: 1.98 },
  host: { cx: 50, cy: 53.45, r: 6.28, width: 4.08 },
};

/** 24 px and under (the title bar): stem, bowl and leg, heavier, a smaller R in a wider orbit
 * (radius 27.5) with the Host at 45°, so the R never touches the orbit. */
const SMALL: Cut = {
  viewBox: "2.5 2.5 59 59",
  orbit: "M37.1 59.02A27.5 27.5 0 1 1 59.02 37.1",
  orbitWidth: 3.74,
  edges: "M23.08 44.32V19.68H31.88A7.04 7.04 0 0 1 31.88 33.76H23.08M31 33.76L45.4 46.22",
  edgeWidth: 5.2,
  hosts: [],
  r: 5.8,
  box: { x: 17.86, y: 39.1, size: 10.44, rx: 2.2 },
  host: { cx: 51.45, cy: 51.45, r: 7, width: 4 },
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
      <rect className="logo-node" x={c.box.x} y={c.box.y} width={c.box.size} height={c.box.size} rx={c.box.rx} />
      <circle className="logo-host" cx={c.host.cx} cy={c.host.cy} r={c.host.r} fill="none" strokeWidth={c.host.width} />
    </svg>
  );
}
