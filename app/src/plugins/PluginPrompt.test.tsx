// The install and permission prompt's keys (decision Q87): it opens on the safe choice, and a
// held-down Enter (one that started before the prompt came up) answers nothing.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PluginPrompt } from "./PluginsPanel";
import type { Prompt } from "./manager";

const prompt = (kind: Prompt["kind"]): Prompt => ({
  kind,
  path: "~/plugins/example",
  manifest: {
    name: "example",
    version: "1.0.0",
    description: "An example",
    author: null,
    api: 2,
    permissions: [{ name: "terminal.read", summary: "Read what your Sessions print", risk: "Sees everything" }],
  },
  asking: ["terminal.read"],
});

const actions = () => screen.getByRole("alertdialog").querySelector(".edit-actions") as HTMLElement;

describe("PluginPrompt", () => {
  it.each([
    ["install", "Cancel"],
    ["update", "Not now"],
  ] as const)("a %s prompt opens with the keys on %s, and Enter there declines", async (kind, safe) => {
    const onAnswer = vi.fn();
    const user = userEvent.setup();
    render(<PluginPrompt prompt={prompt(kind)} onAnswer={onAnswer} />);
    expect(within(actions()).getByRole("button", { name: safe })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(onAnswer).not.toHaveBeenCalledWith(true);
  });

  it("installs only by moving to Install on purpose", async () => {
    const onAnswer = vi.fn();
    const user = userEvent.setup();
    render(<PluginPrompt prompt={prompt("install")} onAnswer={onAnswer} />);
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(within(actions()).getByRole("button", { name: "Install" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it("a repeating Enter (held from before it came up) does nothing", () => {
    const onAnswer = vi.fn();
    render(<PluginPrompt prompt={prompt("install")} onAnswer={onAnswer} />);
    const install = within(actions()).getByRole("button", { name: "Install" });
    // fireEvent says false when the default (the button's click) was prevented.
    expect(fireEvent.keyDown(install, { key: "Enter", repeat: true })).toBe(false);
    expect(fireEvent.keyDown(install, { key: "Enter" })).toBe(true);
  });
});
