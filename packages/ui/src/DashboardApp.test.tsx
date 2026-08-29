import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardApp } from "./DashboardApp.js";
import { createDemoDataClient } from "./client.js";
import type { SisyphusDataClient } from "./data-client.js";

afterEach(() => cleanup());

describe("DashboardApp", () => {
  it("labels built-in sample data without claiming a cloud connection", async () => {
    render(<DashboardApp client={createDemoDataClient()} hostContext={{ kind: "web" }} />);

    expect(await screen.findByText("Demo data")).toBeInTheDocument();
    expect(screen.getByText("No runtime or cloud service is connected.")).toBeInTheDocument();
    expect(screen.getByText("Demo workspace")).toBeInTheDocument();
    expect(screen.queryByText("Production workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Cloud synced")).not.toBeInTheDocument();
  });

  it("filters the dashboard to one runtime cohort", async () => {
    const user = userEvent.setup();
    render(<DashboardApp client={createDemoDataClient()} />);

    expect(await screen.findByText("Comparable runtime cohorts")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Runtime"), "opencode");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "OpenCode" })).toBeInTheDocument();
    });
    expect(screen.getAllByText("Observed only").length).toBeGreaterThan(0);
  });

  it("restores a quarantined skill to probation with an audit reason", async () => {
    const user = userEvent.setup();
    render(<DashboardApp client={createDemoDataClient()} />);

    await screen.findByText("Comparable runtime cohorts");
    await user.click(screen.getByRole("button", { name: /^Skills/u }));
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await user.type(
      screen.getByLabelText("Reason for restoration"),
      "The adapter guard now passes its conformance suite.",
    );
    await user.click(screen.getByRole("button", { name: "Restore to probation" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("Probation").length).toBeGreaterThan(0);
  });

  it("shows decrypted evidence only when the desktop broker is supported", async () => {
    const user = userEvent.setup();
    const readLocalEvidence = vi.fn(async () => ({
      digest: "d".repeat(64),
      evidence: "private device transcript",
    }));
    render(
      <DashboardApp
        client={createDemoDataClient()}
        hostContext={{
          kind: "desktop",
          worker: {
            kind: "online",
            version: "0.1.0",
            pendingUploads: 0,
            policyMode: "local-policy",
          },
          localEvidence: { kind: "supported" },
          adapterAccess: [{ kind: "paired", runtime: "codex" }],
        }}
        readLocalEvidence={readLocalEvidence}
      />,
    );

    await screen.findByText("Comparable runtime cohorts");
    await user.click(screen.getByRole("button", { name: /^Runs/u }));
    const evidenceButtons = await screen.findAllByRole("button", { name: "View local" });
    const firstEvidenceButton = evidenceButtons[0];
    if (firstEvidenceButton === undefined) throw new Error("Missing evidence button.");
    await user.click(firstEvidenceButton);

    expect(await screen.findByText("private device transcript")).toBeInTheDocument();
    expect(readLocalEvidence).toHaveBeenCalledOnce();
  });

  it("does not claim a local adapter is healthy before desktop credentials are paired", async () => {
    const user = userEvent.setup();
    const reason = "Launch desktop and Codex with matching credentials.";
    render(
      <DashboardApp
        client={createDemoDataClient()}
        hostContext={{
          kind: "desktop",
          worker: {
            kind: "online",
            version: "0.1.0",
            pendingUploads: 0,
            policyMode: "local-policy",
          },
          localEvidence: { kind: "supported" },
          adapterAccess: [{ kind: "setup-required", runtime: "codex", reason }],
        }}
      />,
    );

    expect(await screen.findByText(/adapter setup needed/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Integrations/u }));
    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(screen.getAllByText("Degraded").length).toBeGreaterThan(0);
  });

  it("labels an online worker that is intentionally using offline defaults", async () => {
    render(
      <DashboardApp
        client={createDemoDataClient()}
        hostContext={{
          kind: "desktop",
          worker: {
            kind: "online",
            version: "0.1.0",
            pendingUploads: 0,
            policyMode: "offline-default",
          },
          localEvidence: { kind: "supported" },
          adapterAccess: [{ kind: "paired", runtime: "codex" }],
        }}
      />,
    );

    expect(await screen.findByText(/offline defaults/u)).toBeInTheDocument();
    expect(
      screen.getByText("Dashboard uses sample records. Worker status is shown above."),
    ).toBeInTheDocument();
  });

  it("ranks agents only inside matching runtime and profile cohorts", async () => {
    const user = userEvent.setup();
    const demoClient = createDemoDataClient();
    const snapshot = await demoClient.getDashboard({});
    const cursorAgent = snapshot.agents.find((agent) => agent.runtime === "cursor");
    if (cursorAgent === undefined) throw new Error("Missing Cursor demo agent.");
    const client: SisyphusDataClient = {
      dataSource: { kind: "demo" },
      async getDashboard() {
        return {
          ...snapshot,
          agents: [
            { ...cursorAgent, id: "cursor-local", profile: "local" },
            { ...cursorAgent, id: "cursor-cloud", profile: "cloud-agent" },
          ],
        };
      },
      restoreSkill: (skillVersionId, input) =>
        demoClient.restoreSkill(skillVersionId, input),
    };
    render(<DashboardApp client={client} />);

    await screen.findByText("Comparable runtime cohorts");
    await user.click(screen.getByRole("button", { name: /^Agents/u }));

    expect(
      await screen.findByRole("heading", {
        name: /Cursor · Local · runtime 1\.6\.27 · adapter 0\.1\.0-preview\.1 · Verified attribution · Partial/u,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /Cursor · Cloud agent · runtime 1\.6\.27 · adapter 0\.1\.0-preview\.1 · Verified attribution · Partial/u,
      }),
    ).toBeInTheDocument();
  });

  it("identifies cohorts split by installation or capability snapshot", async () => {
    const user = userEvent.setup();
    const demoClient = createDemoDataClient();
    const snapshot = await demoClient.getDashboard({});
    const cursorAgent = snapshot.agents.find((agent) => agent.runtime === "cursor");
    if (cursorAgent === undefined) throw new Error("Missing Cursor demo agent.");
    const client: SisyphusDataClient = {
      dataSource: { kind: "demo" },
      async getDashboard() {
        return {
          ...snapshot,
          agents: [
            {
              ...cursorAgent,
              id: "cursor-installation-a",
              adapterInstallationId: "installation-cursor-a",
              comparisonCohortId: "1".repeat(64),
            },
            {
              ...cursorAgent,
              id: "cursor-installation-b",
              adapterInstallationId: "installation-cursor-b",
              comparisonCohortId: "2".repeat(64),
            },
          ],
        };
      },
      restoreSkill: (skillVersionId, input) =>
        demoClient.restoreSkill(skillVersionId, input),
    };
    render(<DashboardApp client={client} />);

    await screen.findByText("Comparable runtime cohorts");
    await user.click(screen.getByRole("button", { name: /^Agents/u }));

    expect(
      await screen.findByText("Installation installation-cursor-a · cohort 11111111"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Installation installation-cursor-b · cohort 22222222"),
    ).toBeInTheDocument();
  });

  it("counts partial policy capabilities as gaps", async () => {
    const user = userEvent.setup();
    render(<DashboardApp client={createDemoDataClient()} />);

    await screen.findByText("Comparable runtime cohorts");
    await user.click(screen.getByRole("button", { name: /^Policies/u }));

    const baseline = screen.getByText("Sample team baseline").closest("article");
    if (baseline === null) throw new Error("Missing sample team baseline policy card.");
    expect(within(baseline).getByText("Capability gaps").nextElementSibling).toHaveTextContent("2");
  });
});
