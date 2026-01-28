import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { handleStatus } from "./status";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { handleCommit } from "./commit";
import { NodeState } from "../types";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("tot_status", () => {
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

  test("returns status for new investigation", async () => {
    const result = await handleStatus({ sessionId }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.currentRound).toBe(1);
    expect(result.totalNodes).toBe(0);
  });

  test("returns node counts after commits", async () => {
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
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" },
          { nodeId: "R1.B", state: NodeState.DEAD, findings: "Dead" },
        ],
      },
      TEST_DIR
    );

    const result = await handleStatus({ sessionId }, TEST_DIR);

    expect(result.totalNodes).toBe(2);
    expect(result.activeDrills).toBe(1);
    expect(result.terminalNodes).toBe(1);
  });

  test("includes DOT graph", async () => {
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
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" },
          { nodeId: "R1.B", state: NodeState.DEAD, findings: "Dead" },
        ],
      },
      TEST_DIR
    );

    const result = await handleStatus({ sessionId }, TEST_DIR);

    expect(result.dot).toContain("digraph");
    expect(result.dot).toContain("R1_A");
  });

  test("shows canEnd status", async () => {
    const result = await handleStatus({ sessionId }, TEST_DIR);

    expect(result.canEnd).toBe(false);
    expect(result.endBlocker).toBeDefined();
  });

  test("rejects invalid session", async () => {
    const result = await handleStatus({ sessionId: "invalid" }, TEST_DIR);

    expect(result.status).toBe("REJECTED");
  });
});
