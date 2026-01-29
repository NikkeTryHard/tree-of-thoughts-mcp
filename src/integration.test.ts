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
    // Round 1 - Single root paradigm
    const startResult = await handleStart({ query: "Test query" }, TEST_DIR);
    expect(startResult.sessionId).toBeDefined();
    const sessionId = startResult.sessionId;

    // Propose R1 - single root
    const proposeR1 = await handlePropose(
      {
        sessionId,
        nodes: [{ id: "R1.A", parent: null, title: "Root query", plannedAction: "Explore main query" }],
      },
      TEST_DIR,
    );
    expect(proposeR1.status).toBe("OK");

    const commitR1 = await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "Found paths to explore" }],
      },
      TEST_DIR,
    );
    expect(commitR1.status).toBe("OK");
    expect(commitR1.canEnd).toBe(false);

    // Round 2 - Branch wide from R1.A
    const proposeR2 = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "Path A1", plannedAction: "Dig deeper" },
          { id: "R2.A2", parent: "R1.A", title: "Path A2", plannedAction: "Dig deeper" },
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
        ],
      },
      TEST_DIR,
    );
    expect(commitR2.status).toBe("OK");

    // Round 3 - Continue branching (FOUND at R3 gets auto-converted to EXPLORE)
    const proposeR3 = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "Deep A1a", plannedAction: "Continue" },
          { id: "R3.A1b", parent: "R2.A1", title: "Deep A1b", plannedAction: "Continue" },
        ],
      },
      TEST_DIR,
    );
    expect(proposeR3.status).toBe("OK");

    const commitR3 = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "Promising lead" },
          { nodeId: "R3.A1b", state: NodeState.DEAD, findings: "Dead end" },
        ],
      },
      TEST_DIR,
    );
    expect(commitR3.status).toBe("OK");

    // Round 4 - Can use FOUND here (R4+)
    const proposeR4 = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R4.A1a1", parent: "R3.A1a", title: "Solution candidate", plannedAction: "Final check" },
          { id: "R4.A1a2", parent: "R3.A1a", title: "Alternative", plannedAction: "Final check" },
        ],
      },
      TEST_DIR,
    );
    expect(proposeR4.status).toBe("OK");

    const commitR4 = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R4.A1a1", state: NodeState.FOUND, findings: "Found solution" },
          { nodeId: "R4.A1a2", state: NodeState.DEAD, findings: "Dead end" },
        ],
      },
      TEST_DIR,
    );
    expect(commitR4.status).toBe("OK");
    expect(commitR4.canEnd).toBe(false); // FOUND needs VERIFY child, also need round 5

    // Round 5 - Add VERIFY child for R4.A1a1
    const proposeR5 = await handlePropose(
      {
        sessionId,
        nodes: [{ id: "R5.A1a1a", parent: "R4.A1a1", title: "Verify solution", plannedAction: "Confirm" }],
      },
      TEST_DIR,
    );
    expect(proposeR5.status).toBe("OK");

    const commitR5 = await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R5.A1a1a", state: NodeState.VERIFY, findings: "Confirmed" }],
      },
      TEST_DIR,
    );
    expect(commitR5.status).toBe("OK");
    expect(commitR5.canEnd).toBe(true);

    // End
    const endResult = await handleEnd({ sessionId }, TEST_DIR);
    expect(endResult.status).toBe("OK");
    expect(endResult.solutions.length).toBe(1); // R4.A1a1
    expect(endResult.deadEnds).toBe(3); // R2.A2, R3.A1b, R4.A1a2
  });

  test("rejects end before round 5", async () => {
    const startResult = await handleStart({ query: "Test" }, TEST_DIR);
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
    expect(endResult.reason).toContain("< 5");
  });

  test("rejects commit without propose", async () => {
    const startResult = await handleStart({ query: "Test" }, TEST_DIR);

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

  test("rejects tot_end when EXPLORE node has < 2 children", async () => {
    const startResult = await handleStart({ query: "Test EXPLORE enforcement" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Round 1
    await handlePropose(
      {
        sessionId,
        nodes: [{ id: "R1.A", parent: null, title: "Root", plannedAction: "Explore" }],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "Found paths" }],
      },
      TEST_DIR,
    );

    // Round 2 - Add 2 children to R1.A
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "Path 1", plannedAction: "Dig" },
          { id: "R2.A2", parent: "R1.A", title: "Path 2", plannedAction: "Dig" },
        ],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "More" }, // EXPLORE with 0 children
          { nodeId: "R2.A2", state: NodeState.DEAD, findings: "Dead" },
        ],
      },
      TEST_DIR,
    );

    // Round 3 - Only add 1 child to R2.A1 (needs 2)
    await handlePropose(
      {
        sessionId,
        nodes: [{ id: "R3.A1a", parent: "R2.A1", title: "Single child", plannedAction: "Continue" }],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R3.A1a", state: NodeState.DEAD, findings: "Dead end" }],
      },
      TEST_DIR,
    );

    // Round 4
    await handlePropose(
      {
        sessionId,
        nodes: [{ id: "R4.X", parent: "R1.A", title: "Extra", plannedAction: "Pad round" }],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R4.X", state: NodeState.DEAD, findings: "Dead" }],
      },
      TEST_DIR,
    );

    // Round 5
    await handlePropose(
      {
        sessionId,
        nodes: [{ id: "R5.Y", parent: "R1.A", title: "Extra", plannedAction: "Pad round" }],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R5.Y", state: NodeState.DEAD, findings: "Dead" }],
      },
      TEST_DIR,
    );

    // Try to end - should be REJECTED because R2.A1 (EXPLORE) only has 1 child
    const endResult = await handleEnd({ sessionId }, TEST_DIR);
    expect(endResult.status).toBe("REJECTED");
    expect(endResult.reason).toContain("BLOCKED");
    expect(endResult.reason).toContain("R2.A1");
    expect(endResult.reason).toContain("has 1");
    expect(endResult.reason).toContain("needs 2");
  });
});
