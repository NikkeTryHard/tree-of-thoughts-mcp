import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { InvestigationState } from "../state/investigation";
import * as fs from "fs";

const TEST_DIR = "./test-investigations-propose";

describe("propose timestamp", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it("stores proposedAt timestamp on proposals", async () => {
    const start = await handleStart({ query: "Test" }, TEST_DIR);
    const before = Date.now();

    await handlePropose({
      sessionId: start.sessionId,
      nodes: [{ id: "R1.A", parent: null, title: "Test", plannedAction: "Test" }],
    }, TEST_DIR);

    const after = Date.now();
    const state = InvestigationState.load(start.sessionId, TEST_DIR);
    const proposal = state!.getPendingProposal("R1.A");

    expect(proposal?.proposedAt).toBeGreaterThanOrEqual(before);
    expect(proposal?.proposedAt).toBeLessThanOrEqual(after);
  });
});
