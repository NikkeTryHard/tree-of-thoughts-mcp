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

    // Then commit
    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R1.A", state: NodeState.DRILL, findings: "Found something" },
          { nodeId: "R1.B", state: NodeState.DEAD, findings: "Dead end" },
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

    // 2 DRILL nodes = 4 children needed for current round
    expect(result.nextRoundInfo.nodesRequired).toBe(4);
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

    // 4 nodes needed, 5 per batch = 1 batch
    expect(result.nextRoundInfo.totalBatches).toBe(1);
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
});
