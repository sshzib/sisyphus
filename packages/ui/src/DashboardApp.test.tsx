import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardApp } from "./DashboardApp.js";
import { createDemoDataClient } from "./client.js";

afterEach(() => cleanup());

describe("DashboardApp", () => {
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
          worker: { kind: "online", version: "0.1.0", pendingUploads: 0 },
          localEvidence: { kind: "supported" },
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
});
