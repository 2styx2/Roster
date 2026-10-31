// How long the Picker takes to open (ticket 20, decision Q86): from the key or click that asks for
// it to the frame it's first drawn in (the next animation frame after React committed it). `:info`
// shows the last one. Two numbers and no timers: nothing runs while the Picker is closed.

export interface PickerTimer {
  /** The Picker was asked for (the `find` command). A second ask before it shows keeps the first. */
  start(): void;
  /** The Picker was committed to the DOM; the time stops at the next frame. */
  shown(): void;
  /** The last open time in ms, or null before the first. */
  last(): number | null;
}

export function pickerTimer(
  now: () => number = () => performance.now(),
  frame: (f: () => void) => void = (f) => void requestAnimationFrame(() => f()),
): PickerTimer {
  let started: number | null = null;
  let last: number | null = null;
  return {
    start() {
      started ??= now();
    },
    shown() {
      if (started === null) return;
      const from = started;
      started = null;
      frame(() => {
        last = now() - from;
      });
    },
    last: () => last,
  };
}
