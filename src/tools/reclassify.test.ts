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

    // Set up initial nodes
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
          { nodeId: "R1.A", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
          { nodeId: "R1.B", state: NodeState.VALID, findings: "Valid", evidence: "This is a valid solution because it meets all requirements and has been verified through testing" },
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
        nodeId: "R1.A",
        newState: NodeState.DRILL,
      },
      TEST_DIR
    );

    expect(result.status).toBe("OK");
    expect(result.previousState).toBe(NodeState.DEAD);
    expect(result.newState).toBe(NodeState.DRILL);
  });

  test("rejects reclassification of node with children to terminal", async () => {
    // First reclassify to DRILL
    await handleReclassify(
      { sessionId, nodeId: "R1.A", newState: NodeState.DRILL },
      TEST_DIR
    );

    // Add a child
    await handlePropose(
      {
        sessionId,
        nodes: [{ id: "R2.A1", parent: "R1.A", title: "Child", plannedAction: "Do" }],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R2.A1", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" }],
      },
      TEST_DIR
    );

    // Try to reclassify parent to terminal
    const result = await handleReclassify(
      { sessionId, nodeId: "R1.A", newState: NodeState.DEAD },
      TEST_DIR
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errors[0].error).toBe("HAS_CHILDREN");
  });

  test("updates DOT graph after reclassification", async () => {
    const result = await handleReclassify(
      { sessionId, nodeId: "R1.A", newState: NodeState.DRILL },
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
