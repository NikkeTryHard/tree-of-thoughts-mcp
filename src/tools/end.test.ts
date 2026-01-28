import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { handleEnd } from "./end";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { handleCommit } from "./commit";
import { NodeState } from "../types";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("tot_end", () => {
  let sessionId: string;

  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    const startResult = await handleStart({ query: "Test", minRoots: 1 }, TEST_DIR);
    sessionId = startResult.sessionId;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("rejects end before round 3", async () => {
    await handlePropose(
      { sessionId, nodes: [{ id: "R1.A", parent: null, title: "A", plannedAction: "A" }] },
      TEST_DIR
    );
    await handleCommit(
      { sessionId, results: [{ nodeId: "R1.A", state: NodeState.VALID, findings: "Done" }] },
      TEST_DIR
    );

    const result = await handleEnd({ sessionId }, TEST_DIR);

    expect(result.status).toBe("REJECTED");
    expect(result.reason).toContain("RECOVERY_REQUIRED");
  });

  test("allows end after round 3 with all terminal nodes", async () => {
    // Round 1
    await handlePropose(
      { sessionId, nodes: [{ id: "R1.A", parent: null, title: "A", plannedAction: "A" }] },
      TEST_DIR
    );
    await handleCommit(
      { sessionId, results: [{ nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" }] },
      TEST_DIR
    );

    // Round 2
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "A1", plannedAction: "A1" },
          { id: "R2.A2", parent: "R1.A", title: "A2", plannedAction: "A2" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.DRILL, findings: "Lead" },
          { nodeId: "R2.A2", state: NodeState.DEAD, findings: "Dead" },
        ],
      },
      TEST_DIR
    );

    // Round 3
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "A1a", plannedAction: "A1a" },
          { id: "R3.A1b", parent: "R2.A1", title: "A1b", plannedAction: "A1b" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.VALID, findings: "Solution!" },
          { nodeId: "R3.A1b", state: NodeState.DEAD, findings: "Dead" },
        ],
      },
      TEST_DIR
    );

    const result = await handleEnd({ sessionId }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.finalDot).toContain("digraph");
    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0].nodeId).toBe("R3.A1a");
  });

  test("returns summary with solutions and theories", async () => {
    // Build a 3-round investigation with VALID and SPEC results
    await handlePropose(
      { sessionId, nodes: [{ id: "R1.A", parent: null, title: "A", plannedAction: "A" }] },
      TEST_DIR
    );
    await handleCommit(
      { sessionId, results: [{ nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" }] },
      TEST_DIR
    );

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "A1", plannedAction: "A1" },
          { id: "R2.A2", parent: "R1.A", title: "A2", plannedAction: "A2" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.DRILL, findings: "More" },
          { nodeId: "R2.A2", state: NodeState.SPEC, findings: "Theory" },
        ],
      },
      TEST_DIR
    );

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "A1a", plannedAction: "A1a" },
          { id: "R3.A1b", parent: "R2.A1", title: "A1b", plannedAction: "A1b" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.VALID, findings: "Found it" },
          { nodeId: "R3.A1b", state: NodeState.DEAD, findings: "Nope" },
        ],
      },
      TEST_DIR
    );

    const result = await handleEnd({ sessionId }, TEST_DIR);

    expect(result.solutions).toHaveLength(1);
    expect(result.theories).toHaveLength(1);
    expect(result.theories[0].nodeId).toBe("R2.A2");
  });
});
