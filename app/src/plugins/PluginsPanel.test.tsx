// `:plugins`' rows: each network site a Plugin was granted says how many requests went there
// since the app started (decision Q116): counts and a time, never what was sent.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PluginsPanel } from "./PluginsPanel";
import type { PluginStatus, Snapshot } from "./manager";

const NOW = Date.now();

const status = (over: Partial<PluginStatus> = {}): PluginStatus => ({
  name: "webhook",
  path: "~/plugins/webhook",
  builtin: false,
  manifest: {
    name: "webhook",
    version: "1.0.0",
    description: "Posts alerts",
    author: null,
    api: 2,
    permissions: [
      { name: "network:hooks.example.com", summary: "Send and fetch over the network: hooks.example.com", risk: "Can send data" },
      { name: "network:private:nas.lan", summary: "Send and fetch over the network: nas.lan on your private network", risk: "Can send data" },
      { name: "network:api.example.com", summary: "Send and fetch over the network: api.example.com", risk: "Can send data" },
    ],
  },
  granted: ["network:hooks.example.com", "network:private:nas.lan"],
  problem: null,
  waiting: false,
  uses: [],
  requests: [{ site: "hooks.example.com", requests: 1234, failed: 2, last: NOW - 120_000 }],
  ...over,
});

const snap = (plugins: PluginStatus[]): Snapshot => ({
  plugins,
  packages: [],
  prompts: [],
  notices: [],
  float: null,
  confirm: null,
  progress: [],
  declined: [],
  settled: true,
});

const row = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("PluginsPanel's request counts", () => {
  it("says under each granted site how many requests went there, how many failed, and when", () => {
    render(<PluginsPanel snapshot={snap([status()])} onGrant={() => undefined} onClose={() => undefined} />);
    expect(within(row("network:hooks.example.com")).getByText("1,234 requests, 2 with no answer, the last 2m ago")).toBeInTheDocument();
    expect(within(row("network:private:nas.lan")).getByText("No requests since roster started")).toBeInTheDocument();
    // Not granted: nothing to count.
    expect(within(row("network:api.example.com")).queryByText(/requests/)).toBeNull();
  });

  it("says one request in the singular, and nothing about failures when there were none", () => {
    render(
      <PluginsPanel
        snapshot={snap([status({ requests: [{ site: "hooks.example.com", requests: 1, failed: 0, last: NOW - 600_000 }] })])}
        onGrant={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(within(row("network:hooks.example.com")).getByText("1 request, the last 10m ago")).toBeInTheDocument();
  });
});
