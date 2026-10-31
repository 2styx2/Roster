// The mark (Gap orbit, plain; decision Q57) for use inside the app: no tile, drawn with Theme
// tokens so it follows every Theme. The R, its orbit and the Box at the foot of the stem are the
// text colour (faded as in the masters); the one accent is the Host where the orbit breaks, the
// node the leg reaches. The app icon is the same drawing with no tile either, in one mid-tone
// neutral that reads on light and dark taskbars (assets/logo-icon.svg and the logo-icon-small*.svg cuts,
// rendered by app/scripts/icons.mjs; decision Q59).

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

/** 25 px and up (lock screen, empty states): the full R, five nodes and the leg, filling most of an
 * orbit of radius 26 (the round-5 prototype's proportions, decision Q59) with the Host at 50°; the
 * R sits about 2 px clear of the orbit at 25 px. */
const FULL: Cut = {
  viewBox: "4 4 57 57",
  orbit: "M38.33 57.22A26 26 0 1 1 55.74 42.61",
  orbitWidth: 2.1,
  edges: "M25 17.5V45.5M25 17.5H38L44 24.5L38 31.5H25M38 31.5L45.84 46.44",
  edgeWidth: 3.5,
  hosts: [
    [25, 17.5],
    [25, 31.5],
    [38, 17.5],
    [44, 24.5],
    [38, 31.5],
  ],
  r: 4.6,
  box: { x: 20.49, y: 40.99, size: 9.02, rx: 1.75 },
  host: { cx: 48.71, cy: 51.92, r: 5.7, width: 3.32 },
};

/** 24 px and under (the title bar): stem, bowl and leg, heavier, in the same orbit (radius 26,
 * Host at 50°), the R moved up and right so it clears the orbit by about 1 px at 16 px and never
 * touches it. */
const SMALL: Cut = {
  viewBox: "3.5 3.5 58 58",
  orbit: "M32.92 57.98A26 26 0 1 1 57.43 37.41",
  orbitWidth: 3.74,
  edges: "M25 43.5V15.5H35A8 8 0 0 1 35 31.5H25M34 31.5L43.74 45.02",
  edgeWidth: 5.2,
  hosts: [],
  r: 5.8,
  box: { x: 19.32, y: 37.82, size: 11.37, rx: 2.2 },
  host: { cx: 48.71, cy: 51.92, r: 7.5, width: 4 },
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
