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
    const startResult = await handleStart({ query: "Test query", projectDir: "/tmp/test-project" }, TEST_DIR);
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
        results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "Found paths to explore", agentId: "a000001" }],
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
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "More to explore", agentId: "a000002" },
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "Another path", agentId: "a000003" },
        ],
      },
      TEST_DIR,
    );
    expect(commitR2.status).toBe("OK");

    // Round 3 - Continue branching for both R2 children
    const proposeR3 = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "Deep A1a", plannedAction: "Continue" },
          { id: "R3.A1b", parent: "R2.A1", title: "Deep A1b", plannedAction: "Continue" },
          { id: "R3.A2a", parent: "R2.A2", title: "Deep A2a", plannedAction: "Continue" },
          { id: "R3.A2b", parent: "R2.A2", title: "Deep A2b", plannedAction: "Continue" },
        ],
      },
      TEST_DIR,
    );
    expect(proposeR3.status).toBe("OK");

    const commitR3 = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "Promising lead", agentId: "a000004" },
          { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "Another lead", agentId: "a000005" },
          { nodeId: "R3.A2a", state: NodeState.EXHAUST, findings: "Exhausted", agentId: "a000006" },
          { nodeId: "R3.A2b", state: NodeState.EXHAUST, findings: "Exhausted", agentId: "a000007" },
        ],
      },
      TEST_DIR,
    );
    expect(commitR3.status).toBe("OK");

    // Round 4 - Can use FOUND and DEAD here (R4+)
    const proposeR4 = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R4.A1a1", parent: "R3.A1a", title: "Solution candidate", plannedAction: "Final check" },
          { id: "R4.A1a2", parent: "R3.A1a", title: "Alternative", plannedAction: "Final check" },
          { id: "R4.A1b1", parent: "R3.A1b", title: "Check", plannedAction: "Check" },
          { id: "R4.A1b2", parent: "R3.A1b", title: "Check", plannedAction: "Check" },
          { id: "R4.A2a1", parent: "R3.A2a", title: "Confirm dead", plannedAction: "Confirm" },
          { id: "R4.A2b1", parent: "R3.A2b", title: "Confirm dead", plannedAction: "Confirm" },
        ],
      },
      TEST_DIR,
    );
    expect(proposeR4.status).toBe("OK");

    const commitR4 = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R4.A1a1", state: NodeState.FOUND, findings: "Found solution", agentId: "a000008" },
          { nodeId: "R4.A1a2", state: NodeState.DEAD, findings: "Dead end", agentId: "a000009" },
          { nodeId: "R4.A1b1", state: NodeState.DEAD, findings: "Dead end", agentId: "a000010" },
          { nodeId: "R4.A1b2", state: NodeState.DEAD, findings: "Dead end", agentId: "a000011" },
          { nodeId: "R4.A2a1", state: NodeState.DEAD, findings: "Confirmed dead", agentId: "a000012" },
          { nodeId: "R4.A2b1", state: NodeState.DEAD, findings: "Confirmed dead", agentId: "a000013" },
        ],
      },
      TEST_DIR,
    );
    expect(commitR4.status).toBe("OK");
    expect(commitR4.canEnd).toBe(false); // FOUND needs 2 VERIFY children now

    // Round 5 - Add 2 VERIFY children for R4.A1a1
    const proposeR5 = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R5.A1a1a", parent: "R4.A1a1", title: "Verify solution 1", plannedAction: "Confirm" },
          { id: "R5.A1a1b", parent: "R4.A1a1", title: "Verify solution 2", plannedAction: "Confirm" },
        ],
      },
      TEST_DIR,
    );
    expect(proposeR5.status).toBe("OK");

    const commitR5 = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R5.A1a1a", state: NodeState.VERIFY, findings: "Confirmed", agentId: "a000014" },
          { nodeId: "R5.A1a1b", state: NodeState.VERIFY, findings: "Confirmed", agentId: "a000015" },
        ],
      },
      TEST_DIR,
    );
    expect(commitR5.status).toBe("OK");
    expect(commitR5.canEnd).toBe(true);

    // End
    const endResult = await handleEnd({ sessionId }, TEST_DIR);
    expect(endResult.status).toBe("OK");
    expect(endResult.solutions.length).toBe(1); // R4.A1a1
    expect(endResult.deadEnds).toBe(5); // R4.A1a2, R4.A1b1, R4.A1b2, R4.A2a1, R4.A2b1
  });

  test("rejects end before round 5", async () => {
    const startResult = await handleStart({ query: "Test", projectDir: "/tmp/test-project" }, TEST_DIR);
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
        results: [{ nodeId: "R1.A", state: NodeState.FOUND, findings: "Done", agentId: "b000001" }],
      },
      TEST_DIR,
    );

    const endResult = await handleEnd({ sessionId }, TEST_DIR);
    expect(endResult.status).toBe("REJECTED");
    expect(endResult.reason).toContain("< 5");
  });

  test("rejects commit without propose", async () => {
    const startResult = await handleStart({ query: "Test", projectDir: "/tmp/test-project" }, TEST_DIR);

    const commitResult = await handleCommit(
      {
        sessionId: startResult.sessionId,
        results: [{ nodeId: "R1.A", state: NodeState.FOUND, findings: "Done", agentId: "b000002" }],
      },
      TEST_DIR,
    );

    expect(commitResult.status).toBe("REJECTED");
    expect(commitResult.errors[0].error).toBe("NOT_PROPOSED");
  });

  test("rejects tot_end when EXPLORE node has < 2 children", async () => {
    const startResult = await handleStart({ query: "Test EXPLORE enforcement", projectDir: "/tmp/test-project" }, TEST_DIR);
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
        results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "Found paths", agentId: "c000001" }],
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
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "More", agentId: "c000002" }, // EXPLORE with 0 children
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "More", agentId: "c000003" },
        ],
      },
      TEST_DIR,
    );

    // Round 3 - Only add 1 child to R2.A1 (needs 2)
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "Single child", plannedAction: "Continue" },
          { id: "R3.A2a", parent: "R2.A2", title: "Child", plannedAction: "Continue" },
          { id: "R3.A2b", parent: "R2.A2", title: "Child", plannedAction: "Continue" },
        ],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "More", agentId: "c000004" },
          { nodeId: "R3.A2a", state: NodeState.EXPLORE, findings: "More", agentId: "c000005" },
          { nodeId: "R3.A2b", state: NodeState.EXPLORE, findings: "More", agentId: "c000006" },
        ],
      },
      TEST_DIR,
    );

    // Round 4
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R4.A1a1", parent: "R3.A1a", title: "Extra", plannedAction: "Pad round" },
          { id: "R4.A1a2", parent: "R3.A1a", title: "Extra", plannedAction: "Pad round" },
        ],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R4.A1a1", state: NodeState.DEAD, findings: "Dead", agentId: "c000007" },
          { nodeId: "R4.A1a2", state: NodeState.DEAD, findings: "Dead", agentId: "c000008" },
        ],
      },
      TEST_DIR,
    );

    // Round 5
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R5.A2a1", parent: "R3.A2a", title: "Extra", plannedAction: "Pad round" },
          { id: "R5.A2a2", parent: "R3.A2a", title: "Extra", plannedAction: "Pad round" },
        ],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R5.A2a1", state: NodeState.DEAD, findings: "Dead", agentId: "c000009" },
          { nodeId: "R5.A2a2", state: NodeState.DEAD, findings: "Dead", agentId: "c000010" },
        ],
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
