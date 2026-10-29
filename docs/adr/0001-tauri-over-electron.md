# Tauri, not Electron, for the desktop shell

roster-desk is a Tauri app: a Rust core with the system webview, using WebView2 on Windows and WebKitGTK on Linux. It's small, starts fast, and the Rust core is a natural home for PTYs and process management. That fits "fast, responsive, feels native" better than shipping a whole Chromium.

## Consequences

- On Linux the UI runs in WebKitGTK, which is slower than Chromium, and xterm.js's WebGL renderer may need its canvas fallback under X11 or WSLg. Ticket 20 measures this. If typing latency on Linux is unacceptable, revisiting this ADR is the escape hatch.
- Rendering differs slightly between platforms. Test both before calling a design done.

## Considered Options

- **Electron**: the same Chromium everywhere and proven with xterm.js (VS Code, Tabby, Hyper), but heavier in memory and size, with a Node core instead of Rust.
- **Native toolkits (Qt, GTK, WinUI)**: truly native widgets, but the terminal and our own design language are much harder, with no xterm.js.
