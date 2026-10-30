#!/usr/bin/env node
// Regenerates the app icon set in src-tauri/icons from the SVG masters in assets/ (logo D1,
// decision Q29). `tauri icon` renders every size from assets/logo.svg; then the 16, 24 and 32 px
// images (the taskbar, the title bar of Explorer windows, the tray) are redrawn from
// assets/logo-small.svg, whose heavier strokes survive small sizes, and icon.ico is repacked
// with them. Run: node scripts/icons.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const icons = join(root, "src-tauri", "icons");
const tauri = (...args) => execFileSync("npx", ["tauri", "icon", ...args], { cwd: root, stdio: "inherit" });

tauri("assets/logo.svg", "-o", icons);
// Desktop only: the mobile sets aren't used.
rmSync(join(icons, "android"), { recursive: true, force: true });
rmSync(join(icons, "ios"), { recursive: true, force: true });

const tmp = mkdtempSync(join(tmpdir(), "roster-icons-"));
try {
  tauri("assets/logo-small.svg", "-o", join(tmp, "small"), "-p", "16,24,32");
  tauri("assets/logo.svg", "-o", join(tmp, "big"), "-p", "48,64,256");
  const layers = [
    ...[16, 24, 32].map((s) => [s, join(tmp, "small", `${s}x${s}.png`)]),
    ...[48, 64, 256].map((s) => [s, join(tmp, "big", `${s}x${s}.png`)]),
  ];
  writeFileSync(join(icons, "icon.ico"), ico(layers.map(([size, file]) => [size, readFileSync(file)])));
  copyFileSync(join(tmp, "small", "32x32.png"), join(icons, "32x32.png"));
} finally {
  rmSync(tmp, { recursive: true, force: true });
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
