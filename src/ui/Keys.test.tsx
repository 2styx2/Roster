import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { chordParts, Keys, WithKeys } from "./Keys";

describe("Keys", () => {
  it("splits chords, a + key included", () => {
    expect(chordParts("Ctrl+Shift+c")).toEqual(["Ctrl", "Shift", "c"]);
    expect(chordParts("Ctrl++")).toEqual(["Ctrl", "+"]);
    expect(chordParts("+")).toEqual(["+"]);
    expect(chordParts("G")).toEqual(["G"]);
  });

  it("draws each key as a cap, and the Leader as the space-bar cap with the chord as its tooltip", () => {
    const { container } = render(<Keys keys="␣ d d" leader="Ctrl+Space" />);
    expect(container.querySelectorAll("kbd")).toHaveLength(3);
    expect(screen.getByTitle("Leader (Ctrl+Space)")).toHaveClass("keycap-leader");
    expect(container).toHaveTextContent("Leader d d");
  });

  it("keeps the chord readable as text (Ctrl+Space), with a cap per key", () => {
    const { container } = render(<Keys keys="Ctrl+Space" />);
    expect([...container.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Ctrl", "Space"]);
    expect(container).toHaveTextContent("Ctrl+Space");
  });

  it("draws key sequences in backticks inside text", () => {
    const { container } = render(<WithKeys text="Drag a Host here or press `␣ a`." />);
    expect(container).toHaveTextContent("Drag a Host here or press Leader a.");
    expect(container.querySelectorAll("kbd")).toHaveLength(2);
  });
});
