import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, mkdirSync } from "fs";
import { handleStart } from "./tools/start";
import { handlePropose } from "./tools/propose";
import { handleCommit } from "./tools/commit";
import { handleEnd } from "./tools/end";

const TEST_DIR = "./test-investigations";

describe("Tree of Thoughts Integration", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("complete workflow: start -> propose -> commit -> end", async () => {
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

    // Commit R1
    const commitR1 = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R1.A", state: "EXPLORE" as any, findings: "Found something" },
          { nodeId: "R1.B", state: "DEAD" as any, findings: "Dead end" },
          { nodeId: "R1.C", state: "FOUND" as any, findings: "Solution found" },
        ],
      },
      TEST_DIR,
    );
    expect(commitR1.status).toBe("OK");
    expect(commitR1.canEnd).toBe(false); // R1.A needs children

    // Round 2 - Add children for R1.A
    const proposeR2 = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "Sub A1", plannedAction: "Dig deeper" },
          { id: "R2.A2", parent: "R1.A", title: "Sub A2", plannedAction: "Dig deeper" },
        ],
      },
      TEST_DIR,
    );
    expect(proposeR2.status).toBe("OK");

    const commitR2 = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: "EXPLORE" as any, findings: "More to explore" },
          { nodeId: "R2.A2", state: "DEAD" as any, findings: "Dead end" },
        ],
      },
      TEST_DIR,
    );
    expect(commitR2.status).toBe("OK");

    // Round 3 - Add children for R2.A1
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
          { nodeId: "R3.A1a", state: "FOUND" as any, findings: "Found solution" },
          { nodeId: "R3.A1b", state: "DEAD" as any, findings: "Dead end" },
        ],
      },
      TEST_DIR,
    );
    expect(commitR3.status).toBe("OK");
    expect(commitR3.canEnd).toBe(true);

    // End
    const endResult = await handleEnd({ sessionId }, TEST_DIR);
    expect(endResult.status).toBe("OK");
    expect(endResult.solutions.length).toBe(2); // R1.C and R3.A1a
    expect(endResult.deadEnds).toBe(3); // R1.B, R2.A2, R3.A1b
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

    await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R1.A", state: "FOUND" as any, findings: "Done" }],
      },
      TEST_DIR,
    );

    const endResult = await handleEnd({ sessionId }, TEST_DIR);
    expect(endResult.status).toBe("REJECTED");
    expect(endResult.reason).toContain("round");
  });

  test("rejects commit without propose", async () => {
    const startResult = await handleStart({ query: "Test", minRoots: 1 }, TEST_DIR);

    const commitResult = await handleCommit(
      {
        sessionId: startResult.sessionId,
        results: [{ nodeId: "R1.A", state: "FOUND" as any, findings: "Done" }],
      },
      TEST_DIR,
    );

    expect(commitResult.status).toBe("REJECTED");
    expect(commitResult.errors[0].error).toBe("NOT_PROPOSED");
  });
});
