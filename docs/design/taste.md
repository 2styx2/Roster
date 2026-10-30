# roster's taste

How roster-desk should look, move and talk, so it feels like *ours* and not "Linear with jade". Linear is the discipline we borrow (density, restraint, a quiet surface). `emil-design-eng` and `animate` are the craft. This page is the identity. Every UI change should be explainable with one of these lines. When they conflict with a reference, **this page wins** (except on accessibility).

## The idea: a live map of your network, and a fast way into it

roster *is* the map: Hosts are nodes, and Sessions are live connections between this Box and them. The logo already says this (D1: nodes joined into an R, with the accent node at the end of the leg, the Host you're connecting to). Carry that one motif everywhere instead of decorating.

## Principles

1. **The terminal is the hero.** Chrome recedes: neutral near-black, hairlines, no gradients, no glass, no shadows on resting surfaces. If a pixel isn't helping you reach or use a shell, it's quiet.
2. **Nodes and edges are our only ornament.**
   - State dots are *nodes*, and their shapes carry meaning: filled = key, ring = password, dashed = unreviewed, hollow grey = ended.
   - Empty states, the lock screen and loading use the D1 graph, small and still, never as wallpaper.
   - "Connecting" is an edge being drawn, a short line from this Box to the Host's node. It isn't a spinner.
3. **Jade means "live".** The accent is spent only on what's connected or actionable now: the current Session's bar, a live node, the primary button, the cursor. Nothing decorative is jade. A screen with no live connection has almost no jade on it.
4. **Two voices of type.**
   - **Iosevka 500** is for *data and the machine*: Host names, addresses, ports, fingerprints, keys, commands and terminal text.
   - **Inter** is for *the app talking to you*: labels, headings and copy.

   If it's something you could paste into a shell, it's in Iosevka.
5. **Keyboard first, and it shows.** Every action has a key, and keycaps sit next to the things they do. Discoverability through keycaps is our onboarding, not tooltips or tours. The mouse is welcome but never required.
6. **Honest, plain voice.** Copy says what happened, where it lives (`roster.yml`, the vault, this Box, the network, the Host), and the one thing to do next. No exclamation marks, no "Oops", no blame, no jargon the user didn't type themselves. A secret is never named "password" in a log line.
7. **Calm under failure.** Errors look like the rest of the app, not like an alarm: the same panel, a clear fix, raw details one keypress away. Red is reserved for "this will break something" (danger) and real failures. Alarm is never used to get attention.
8. **Motion confirms, it never performs.** Motion shows cause and effect: an edge drawn on connect, a node dimming on exit, a panel sliding from the side it belongs to. It's under 150 ms, interruptible, off under reduced motion, and the lock cover is instant. Through `animate`, always.
9. **It's yours.** Every color, font, key and layout piece is a default the Config or a Plugin can change. Defaults are opinionated; they're never locks.

## Signature details (do these consistently)

| Detail | Spec |
|---|---|
| **Connect** | A 1px edge in jade draws from the Sidebar row's node toward the terminal, over about 120 ms. The node fills when the Session reaches a shell. On failure the edge snaps back and the node turns hollow with the error state. |
| **Session ended** | The node empties to a hollow grey ring. The row keeps its place. Nothing jumps. |
| **Empty states** | The D1 graph (small, 48–64px, muted), one plain sentence, and the keycap for the next action. |
| **Lock screen** | The D1 mark, the Box name in Iosevka, one field. Nothing else. |
| **Selection** | Raised fill, plus a 2px jade bar only on the live Session (Q53). The cursor in App mode is raised without the bar. |
| **Data cells** | IPs, ports and fingerprints in Iosevka at the muted color, tabular numbers, never cut mid-token. |
| **Status bar** | Reads like a tmux line: `● WSL: FedoraLinux-44  devbox  91 hosts`. Data in Iosevka, hints as keycaps. |

## Not us

- Glassmorphism, gradients, glows, drop shadows on resting UI, or illustrations of people.
- Spinners where an edge or a node can show progress.
- Toasts for things that belong in place (put errors where the problem is).
- Celebratory motion, bouncy springs on productivity actions, confetti.
- Emoji in our own copy (users' Host names may have them; we render them properly).
- "Dashboard" cards and charts. roster is a map and a terminal, not analytics.

*Proposed 2026-10-30 from decisions Q26–Q53. Refine it as the product grows, and record changes in `docs/decisions.md`.*
