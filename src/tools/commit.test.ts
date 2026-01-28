import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { handleCommit } from "./commit";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { NodeState } from "../types";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("tot_commit", () => {
  let sessionId: string;

  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    const startResult = await handleStart({ query: "Test", minRoots: 2 }, TEST_DIR);
    sessionId = startResult.sessionId;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("commits valid results and updates state", async () => {
    // First propose
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R1.A", parent: null, title: "Node A", plannedAction: "Do A" },
          { id: "R1.B", parent: null, title: "Node B", plannedAction: "Do B" },
        ],
      },
      TEST_DIR
    );

    // Then commit - Round 1 allows 0% terminal, so both must be non-terminal
    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R1.A", state: NodeState.DRILL, findings: "Found something" },
          { nodeId: "R1.B", state: NodeState.DRILL, findings: "More leads" },
        ],
      },
      TEST_DIR
    );

    expect(result.status).toBe("OK");
    expect(result.dot).toContain("R1_A");
    expect(result.dot).toContain("lightblue"); // DRILL color
  });

  test("returns queue status after commit", async () => {
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R1.A", parent: null, title: "A", plannedAction: "A" },
          { id: "R1.B", parent: null, title: "B", plannedAction: "B" },
        ],
      },
      TEST_DIR
    );

    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" },
          { nodeId: "R1.B", state: NodeState.DRILL, findings: "Lead" },
        ],
      },
      TEST_DIR
    );

    // 2 DRILL nodes = 6 children needed for current round (3 each)
    expect(result.nextRoundInfo.nodesRequired).toBe(6);
    // Round stays at 1 until children are added
    expect(result.currentRound).toBe(1);
  });

  test("calculates batch info correctly", async () => {
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R1.A", parent: null, title: "A", plannedAction: "A" },
          { id: "R1.B", parent: null, title: "B", plannedAction: "B" },
        ],
      },
      TEST_DIR
    );

    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" },
          { nodeId: "R1.B", state: NodeState.DRILL, findings: "Lead" },
        ],
      },
      TEST_DIR
    );

    // 6 nodes needed, 5 per batch = 2 batches
    expect(result.nextRoundInfo.totalBatches).toBe(2);
  });

  test("rejects invalid session", async () => {
    const result = await handleCommit(
      {
        sessionId: "invalid",
        results: [],
      },
      TEST_DIR
    );

    expect(result.status).toBe("REJECTED");
  });

  // Task 1.3: Evidence validation tests
  test("rejects terminal state without evidence", async () => {
    await handlePropose({
      sessionId,
      nodes: [
        { id: "R1.A", parent: null, title: "A", plannedAction: "A" },
        { id: "R1.B", parent: null, title: "B", plannedAction: "B" },
      ],
    }, TEST_DIR);

    const result = await handleCommit({
      sessionId,
      results: [
        { nodeId: "R1.A", state: NodeState.DEAD, findings: "Dead end" },
        { nodeId: "R1.B", state: NodeState.DRILL, findings: "More" },
      ],
    }, TEST_DIR);

    expect(result.status).toBe("REJECTED");
    expect(result.errors.some((e) => e.error === "MISSING_EVIDENCE")).toBe(true);
  });

  test("accepts terminal state with evidence", async () => {
    // First, set up round 2 by completing round 1 with DRILL nodes
    await handlePropose({
      sessionId,
      nodes: [
        { id: "R1.A", parent: null, title: "A", plannedAction: "A" },
        { id: "R1.B", parent: null, title: "B", plannedAction: "B" },
      ],
    }, TEST_DIR);

    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" },
        { nodeId: "R1.B", state: NodeState.DRILL, findings: "Lead" },
      ],
    }, TEST_DIR);

    // Add all 6 children needed for round 1 (3 per DRILL node)
    await handlePropose({
      sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "A1", plannedAction: "A1" },
        { id: "R2.A2", parent: "R1.A", title: "A2", plannedAction: "A2" },
        { id: "R2.A3", parent: "R1.A", title: "A3", plannedAction: "A3" },
      ],
    }, TEST_DIR);

    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R2.A1", state: NodeState.DRILL, findings: "More" },
        { nodeId: "R2.A2", state: NodeState.DRILL, findings: "More" },
        { nodeId: "R2.A3", state: NodeState.DRILL, findings: "More" },
      ],
    }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R2.B1", parent: "R1.B", title: "B1", plannedAction: "B1" },
        { id: "R2.B2", parent: "R1.B", title: "B2", plannedAction: "B2" },
        { id: "R2.B3", parent: "R1.B", title: "B3", plannedAction: "B3" },
      ],
    }, TEST_DIR);

    // Now we're in round 2 - Round 2 allows 35% terminal - 1 DEAD out of 3 = 33% is OK
    const result = await handleCommit({
      sessionId,
      results: [
        {
          nodeId: "R2.B1",
          state: NodeState.DEAD,
          findings: "Dead end",
          evidence: "This path is definitively a dead end because X, Y, Z which are insurmountable obstacles",
        },
        { nodeId: "R2.B2", state: NodeState.DRILL, findings: "More" },
        { nodeId: "R2.B3", state: NodeState.DRILL, findings: "More" },
      ],
    }, TEST_DIR);

    expect(result.status).toBe("OK");
  });

  // Task 2.3: Round-locked state validation tests
  test("rejects VALID before round 3 via commit", async () => {
    await handlePropose({
      sessionId,
      nodes: [
        { id: "R1.A", parent: null, title: "A", plannedAction: "A" },
        { id: "R1.B", parent: null, title: "B", plannedAction: "B" },
      ],
    }, TEST_DIR);

    const result = await handleCommit({
      sessionId,
      results: [
        { nodeId: "R1.A", state: NodeState.VALID, findings: "Found", evidence: "This is detailed evidence with more than 50 characters for validation purposes" },
        { nodeId: "R1.B", state: NodeState.DRILL, findings: "More" },
      ],
    }, TEST_DIR);

    expect(result.status).toBe("REJECTED");
    expect(result.errors.some((e) => e.error === "STATE_LOCKED")).toBe(true);
  });

  test("rejects batch exceeding terminal ratio via commit", async () => {
    await handlePropose({
      sessionId,
      nodes: [
        { id: "R1.A", parent: null, title: "A", plannedAction: "A" },
        { id: "R1.B", parent: null, title: "B", plannedAction: "B" },
      ],
    }, TEST_DIR);

    // Round 1 allows 0% terminal, but we're submitting 50% terminal (1 DEAD)
    const result = await handleCommit({
      sessionId,
      results: [
        { nodeId: "R1.A", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
        { nodeId: "R1.B", state: NodeState.DRILL, findings: "More" },
      ],
    }, TEST_DIR);

    expect(result.status).toBe("REJECTED");
    expect(result.errors.some((e) => e.error === "TERMINAL_RATIO_EXCEEDED")).toBe(true);
  });
});
