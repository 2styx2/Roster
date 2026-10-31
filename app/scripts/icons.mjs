#!/usr/bin/env node
// Regenerates the app icon set in src-tauri/icons from the SVG masters in assets/ (Gap orbit,
// plain, decisions Q57 and Q59). The icon has no tile: a transparent mark in one mid-tone neutral
// and a mid apricot Host, so it reads on the light and the dark Windows taskbar alike.
// `tauri icon` renders every size from assets/logo-icon.svg; then the 16, 20, 24 and 32 px images
// (the taskbar, title bars, Alt+Tab, the tray) are redrawn from the small cut, one master per size
// drawn on that size's own pixel grid (assets/logo-icon-small-16.svg, -20, -24, and
// logo-icon-small.svg for 32), so the network R's nodes still read there (issue #78, decision Q65),
// and icon.ico is repacked with them plus 40, 48, 64 and 256 from the full cut.
// Run: `npm run icons` in app/ (or node app/scripts/icons.mjs)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const icons = join(root, "src-tauri", "icons");
const tauri = (...args) => execFileSync("npx", ["tauri", "icon", ...args], { cwd: root, stdio: "inherit" });
const SMALL = [16, 20, 24, 32];
const FULL = [40, 48, 64, 256];

tauri("assets/logo-icon.svg", "-o", icons);
// Desktop only: the mobile sets aren't used.
rmSync(join(icons, "android"), { recursive: true, force: true });
rmSync(join(icons, "ios"), { recursive: true, force: true });

const tmp = mkdtempSync(join(tmpdir(), "roster-icons-"));
try {
  for (const s of SMALL) tauri(smallCut(s), "-o", join(tmp, `small-${s}`), "-p", String(s));
  tauri("assets/logo-icon.svg", "-o", join(tmp, "big"), "-p", FULL.join(","));
  const layers = [
    ...SMALL.map((s) => [s, join(tmp, `small-${s}`, `${s}x${s}.png`)]),
    ...FULL.map((s) => [s, join(tmp, "big", `${s}x${s}.png`)]),
  ];
  writeFileSync(join(icons, "icon.ico"), ico(layers.map(([size, file]) => [size, readFileSync(file)])));
  copyFileSync(join(tmp, "small-32", "32x32.png"), join(icons, "32x32.png"));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/** The small cut's master for SIZE px: its own pixel grid's (32 px is logo-icon-small.svg). */
function smallCut(size) {
  return size === 32 ? "assets/logo-icon-small.svg" : `assets/logo-icon-small-${size}.svg`;
}

/** An .ico holding PNG images (Windows Vista and later read PNG layers). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(([size, png], i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt8(0, at + 2);
    header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(([, png]) => png)]);
}
