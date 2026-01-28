import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { handleReclassify } from "./reclassify";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { handleCommit } from "./commit";
import { NodeState } from "../types";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("tot_reclassify", () => {
  let sessionId: string;

  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    const startResult = await handleStart({ query: "Test", minRoots: 2 }, TEST_DIR);
    sessionId = startResult.sessionId;

    // Set up initial nodes - Round 1 requires 0% terminal, so use DRILL
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
          { nodeId: "R1.B", state: NodeState.DRILL, findings: "Lead" },
        ],
      },
      TEST_DIR
    );

    // Add children to complete round 1 and move to round 2
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "A1", plannedAction: "A1" },
          { id: "R2.A2", parent: "R1.A", title: "A2", plannedAction: "A2" },
          { id: "R2.A3", parent: "R1.A", title: "A3", plannedAction: "A3" },
        ],
      },
      TEST_DIR
    );
    // Round 2 allows 35% terminal - 1 DEAD out of 3 = 33%
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
          { nodeId: "R2.A2", state: NodeState.DRILL, findings: "Lead" },
          { nodeId: "R2.A3", state: NodeState.DRILL, findings: "Lead" },
        ],
      },
      TEST_DIR
    );
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("reclassifies terminal node to active", async () => {
    const result = await handleReclassify(
      {
        sessionId,
        nodeId: "R2.A1",
        newState: NodeState.DRILL,
      },
      TEST_DIR
    );

    expect(result.status).toBe("OK");
    expect(result.previousState).toBe(NodeState.DEAD);
    expect(result.newState).toBe(NodeState.DRILL);
  });

  test("rejects reclassification of node with children to terminal", async () => {
    // R1.A already has children from beforeEach, try to reclassify it to DEAD
    const result = await handleReclassify(
      { sessionId, nodeId: "R1.A", newState: NodeState.DEAD },
      TEST_DIR
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errors[0].error).toBe("HAS_CHILDREN");
  });

  test("updates DOT graph after reclassification", async () => {
    const result = await handleReclassify(
      { sessionId, nodeId: "R2.A1", newState: NodeState.DRILL },
      TEST_DIR
    );

    expect(result.dot).toContain("lightblue"); // DRILL color
  });

  test("rejects non-existent node", async () => {
    const result = await handleReclassify(
      { sessionId, nodeId: "R99.Z", newState: NodeState.DRILL },
      TEST_DIR
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errors[0].error).toBe("NODE_NOT_FOUND");
  });
});
