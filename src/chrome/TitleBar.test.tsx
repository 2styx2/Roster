import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WindowControls } from "../platform/types";
import { TitleBar } from "./TitleBar";

function controls() {
  let maximized: ((m: boolean) => void) | null = null;
  const c = {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    watchMaximized: (cb: (m: boolean) => void) => {
      maximized = cb;
      cb(false);
      return () => {};
    },
    watchGeometry: () => () => {},
  } satisfies WindowControls;
  return { c, setMaximized: (m: boolean) => maximized?.(m) };
}

describe("TitleBar", () => {
  it("is a drag region with the mark, and runs minimize, maximize and close", async () => {
    const { c, setMaximized } = controls();
    const user = userEvent.setup();
    render(<TitleBar controls={c} />);
    expect(screen.getByRole("banner")).toHaveAttribute("data-tauri-drag-region");
    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await user.click(screen.getByRole("button", { name: "Maximize" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(c.minimize).toHaveBeenCalledOnce();
    expect(c.toggleMaximize).toHaveBeenCalledOnce();
    expect(c.close).toHaveBeenCalledOnce();
    act(() => setMaximized(true));
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("has no buttons where there's no window to control", () => {
    render(<TitleBar />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
