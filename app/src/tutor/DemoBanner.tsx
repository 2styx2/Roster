// The demo Inventory's banner (`:tutor`, ticket 55): always on screen while a tutorial runs, so
// nobody mistakes the demo for their network. It says where you are (the second tone's square:
// a place, as this Box's is), the tutorial and how far along it is, and how to leave. It's there
// for as long as the demo is, so it doesn't animate.
import { useState } from "react";
import { Announce } from "../ui/Announce";
import type { TutorialDef } from "./tutor";

export function DemoBanner({ tutorial, done, onLeave }: { tutorial: TutorialDef; done: ReadonlySet<string> | null; onLeave(): void }) {
  const steps = tutorial.lessons.flatMap((l) => l.steps);
  const n = steps.filter((s) => done?.has(s.id)).length;
  const count = n === steps.length ? "every step done" : `${n} of ${steps.length} steps done`;
  // Heard when a step ticks, not when the banner appears.
  const [first] = useState(n);
  return (
    <div className="demo-banner" role="region" aria-label="Demo Inventory">
      <span className="box-mark" aria-hidden="true" />
      <strong>Demo Inventory</strong>
      <span className="demo-banner-what">Made-up Hosts: nothing here reaches your network, vault or roster.yml.</span>
      <span className="demo-banner-count">
        {tutorial.title} · {count}
      </span>
      <Announce text={n > first ? count : ""} delay={150} />
      <button type="button" onClick={onLeave} title=":tutor quit">
        Leave the demo
      </button>
    </div>
  );
}
