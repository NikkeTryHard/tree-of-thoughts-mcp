import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { handleCommit } from "./commit";
import { InvestigationState } from "../state/investigation";
import { NodeState } from "../types";
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

describe("R2 breadth warning", () => {
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

  it("warns when R2 has fewer than 5 nodes", async () => {
    const start = await handleStart({ query: "Test" }, TEST_DIR);

    // Commit R1.A first
    await handlePropose({
      sessionId: start.sessionId,
      nodes: [{ id: "R1.A", parent: null, title: "Root", plannedAction: "Test" }],
    }, TEST_DIR);
    await handleCommit({
      sessionId: start.sessionId,
      results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "r2warn001" }],
    }, TEST_DIR);

    // Propose only 3 R2 nodes - should warn
    const result = await handlePropose({
      sessionId: start.sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "Child1", plannedAction: "Test" },
        { id: "R2.A2", parent: "R1.A", title: "Child2", plannedAction: "Test" },
        { id: "R2.A3", parent: "R1.A", title: "Child3", plannedAction: "Test" },
      ],
    }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.warnings.some(w => w.includes("R2_BREADTH"))).toBe(true);
    expect(result.warnings.some(w => w.includes("3 nodes"))).toBe(true);
  });

  it("no warning when R2 has 5+ nodes", async () => {
    const start = await handleStart({ query: "Test" }, TEST_DIR);

    // Commit R1.A first
    await handlePropose({
      sessionId: start.sessionId,
      nodes: [{ id: "R1.A", parent: null, title: "Root", plannedAction: "Test" }],
    }, TEST_DIR);
    await handleCommit({
      sessionId: start.sessionId,
      results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "r2warn002" }],
    }, TEST_DIR);

    // Propose 5 R2 nodes - no warning
    const result = await handlePropose({
      sessionId: start.sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "Child1", plannedAction: "Test" },
        { id: "R2.A2", parent: "R1.A", title: "Child2", plannedAction: "Test" },
        { id: "R2.A3", parent: "R1.A", title: "Child3", plannedAction: "Test" },
        { id: "R2.A4", parent: "R1.A", title: "Child4", plannedAction: "Test" },
        { id: "R2.A5", parent: "R1.A", title: "Child5", plannedAction: "Test" },
      ],
    }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.warnings.some(w => w.includes("R2_BREADTH"))).toBe(false);
  });

  it("counts existing R2 nodes toward total", async () => {
    const start = await handleStart({ query: "Test" }, TEST_DIR);

    // Commit R1.A first
    await handlePropose({
      sessionId: start.sessionId,
      nodes: [{ id: "R1.A", parent: null, title: "Root", plannedAction: "Test" }],
    }, TEST_DIR);
    await handleCommit({
      sessionId: start.sessionId,
      results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "r2warn003" }],
    }, TEST_DIR);

    // Propose 3 R2 nodes first
    await handlePropose({
      sessionId: start.sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "Child1", plannedAction: "Test" },
        { id: "R2.A2", parent: "R1.A", title: "Child2", plannedAction: "Test" },
        { id: "R2.A3", parent: "R1.A", title: "Child3", plannedAction: "Test" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId: start.sessionId,
      results: [
        { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "r2warn004" },
        { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "r2warn005" },
        { nodeId: "R2.A3", state: NodeState.EXPLORE, findings: "x", agentId: "r2warn006" },
      ],
    }, TEST_DIR);

    // Propose 2 more R2 nodes - total is 5, no warning
    const result = await handlePropose({
      sessionId: start.sessionId,
      nodes: [
        { id: "R2.A4", parent: "R1.A", title: "Child4", plannedAction: "Test" },
        { id: "R2.A5", parent: "R1.A", title: "Child5", plannedAction: "Test" },
      ],
    }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.warnings.some(w => w.includes("R2_BREADTH"))).toBe(false);
  });
});
