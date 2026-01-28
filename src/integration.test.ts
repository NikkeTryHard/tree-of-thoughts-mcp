import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, mkdirSync } from "fs";
import { handleStart } from "./tools/start";
import { handlePropose } from "./tools/propose";
import { handleCommit } from "./tools/commit";
import { handleEnd } from "./tools/end";
import { NodeState } from "./types";

const TEST_DIR = "./test-investigations";

describe("Tree of Thoughts Integration", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("complete workflow: start -> propose -> commit -> end with VERIFY", async () => {
    // Round 1
    const startResult = await handleStart({ query: "Test query", minRoots: 3 }, TEST_DIR);
    expect(startResult.sessionId).toBeDefined();
    const sessionId = startResult.sessionId;

    // Propose R1 nodes
    const proposeR1 = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R1.A", parent: null, title: "Path A", plannedAction: "Explore A" },
          { id: "R1.B", parent: null, title: "Path B", plannedAction: "Explore B" },
          { id: "R1.C", parent: null, title: "Path C", plannedAction: "Explore C" },
        ],
      },
      TEST_DIR,
    );
    expect(proposeR1.status).toBe("OK");

    // Commit R1 - FOUND at R1 gets auto-converted to EXPLORE
    const commitR1 = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R1.A", state: NodeState.EXPLORE, findings: "Found something" },
          { nodeId: "R1.B", state: NodeState.DEAD, findings: "Dead end" },
          { nodeId: "R1.C", state: NodeState.EXPLORE, findings: "More to explore" },
        ],
      },
      TEST_DIR,
    );
    expect(commitR1.status).toBe("OK");
    expect(commitR1.canEnd).toBe(false);

    // Round 2 - Add children for R1.A and R1.C
    const proposeR2 = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "Sub A1", plannedAction: "Dig deeper" },
          { id: "R2.A2", parent: "R1.A", title: "Sub A2", plannedAction: "Dig deeper" },
          { id: "R2.C1", parent: "R1.C", title: "Sub C1", plannedAction: "Dig deeper" },
          { id: "R2.C2", parent: "R1.C", title: "Sub C2", plannedAction: "Dig deeper" },
        ],
      },
      TEST_DIR,
    );
    expect(proposeR2.status).toBe("OK");

    const commitR2 = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "More to explore" },
          { nodeId: "R2.A2", state: NodeState.DEAD, findings: "Dead end" },
          { nodeId: "R2.C1", state: NodeState.DEAD, findings: "Dead end" },
          { nodeId: "R2.C2", state: NodeState.DEAD, findings: "Dead end" },
        ],
      },
      TEST_DIR,
    );
    expect(commitR2.status).toBe("OK");

    // Round 3 - Add children for R2.A1, can use FOUND here
    const proposeR3 = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "Deep A1a", plannedAction: "Final check" },
          { id: "R3.A1b", parent: "R2.A1", title: "Deep A1b", plannedAction: "Final check" },
        ],
      },
      TEST_DIR,
    );
    expect(proposeR3.status).toBe("OK");

    const commitR3 = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.FOUND, findings: "Found solution" },
          { nodeId: "R3.A1b", state: NodeState.DEAD, findings: "Dead end" },
        ],
      },
      TEST_DIR,
    );
    expect(commitR3.status).toBe("OK");
    expect(commitR3.canEnd).toBe(false); // FOUND needs VERIFY child

    // Round 4 - Add VERIFY child for R3.A1a
    const proposeR4 = await handlePropose(
      {
        sessionId,
        nodes: [{ id: "R4.A1a1", parent: "R3.A1a", title: "Verify solution", plannedAction: "Confirm" }],
      },
      TEST_DIR,
    );
    expect(proposeR4.status).toBe("OK");

    const commitR4 = await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R4.A1a1", state: NodeState.VERIFY, findings: "Confirmed" }],
      },
      TEST_DIR,
    );
    expect(commitR4.status).toBe("OK");
    expect(commitR4.canEnd).toBe(true);

    // End
    const endResult = await handleEnd({ sessionId }, TEST_DIR);
    expect(endResult.status).toBe("OK");
    expect(endResult.solutions.length).toBe(1); // R3.A1a
    expect(endResult.deadEnds).toBe(5); // R1.B, R2.A2, R2.C1, R2.C2, R3.A1b
  });

  test("rejects end before round 3", async () => {
    const startResult = await handleStart({ query: "Test", minRoots: 1 }, TEST_DIR);
    const sessionId = startResult.sessionId;

    await handlePropose(
      {
        sessionId,
        nodes: [{ id: "R1.A", parent: null, title: "Test", plannedAction: "Test" }],
      },
      TEST_DIR,
    );

    // FOUND at R1 gets auto-converted to EXPLORE due to depth enforcement
    await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R1.A", state: NodeState.FOUND, findings: "Done" }],
      },
      TEST_DIR,
    );

    const endResult = await handleEnd({ sessionId }, TEST_DIR);
    expect(endResult.status).toBe("REJECTED");
    expect(endResult.reason).toContain("Round");
  });

  test("rejects commit without propose", async () => {
    const startResult = await handleStart({ query: "Test", minRoots: 1 }, TEST_DIR);

    const commitResult = await handleCommit(
      {
        sessionId: startResult.sessionId,
        results: [{ nodeId: "R1.A", state: NodeState.FOUND, findings: "Done" }],
      },
      TEST_DIR,
    );

    expect(commitResult.status).toBe("REJECTED");
    expect(commitResult.errors[0].error).toBe("NOT_PROPOSED");
  });
});
