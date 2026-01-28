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
    // Round 1 allows 0% terminal, so use DRILL
    await handleCommit(
      { sessionId, results: [{ nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" }] },
      TEST_DIR
    );

    const result = await handleEnd({ sessionId }, TEST_DIR);

    expect(result.status).toBe("REJECTED");
    expect(result.reason).toContain("round");
  });

  test("allows end after round 3 with all terminal nodes", async () => {
    // Round 1 - 0% terminal allowed
    await handlePropose(
      { sessionId, nodes: [{ id: "R1.A", parent: null, title: "A", plannedAction: "A" }] },
      TEST_DIR
    );
    await handleCommit(
      { sessionId, results: [{ nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" }] },
      TEST_DIR
    );

    // Round 2 - DRILL requires 3 children, 35% terminal allowed (1 out of 3 = 33%)
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
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.DRILL, findings: "Lead" },
          { nodeId: "R2.A2", state: NodeState.DRILL, findings: "More" },
          { nodeId: "R2.A3", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
        ],
      },
      TEST_DIR
    );

    // Round 3 - need 6 children (3 for each DRILL), 50% terminal allowed
    // Batch 1: children of R2.A1 - 1 VALID out of 3 = 33% terminal (VALID is terminal)
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "A1a", plannedAction: "A1a" },
          { id: "R3.A1b", parent: "R2.A1", title: "A1b", plannedAction: "A1b" },
          { id: "R3.A1c", parent: "R2.A1", title: "A1c", plannedAction: "A1c" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.VALID, findings: "Solution!", evidence: "This is a valid solution because it meets all requirements and has been verified through testing" },
          { nodeId: "R3.A1b", state: NodeState.VERIFY, findings: "Needs verification" },
          { nodeId: "R3.A1c", state: NodeState.VERIFY, findings: "Needs verification" },
        ],
      },
      TEST_DIR
    );

    // Batch 2: children of R2.A2 - 1 DEAD out of 3 = 33% terminal
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A2a", parent: "R2.A2", title: "A2a", plannedAction: "A2a" },
          { id: "R3.A2b", parent: "R2.A2", title: "A2b", plannedAction: "A2b" },
          { id: "R3.A2c", parent: "R2.A2", title: "A2c", plannedAction: "A2c" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A2a", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
          { nodeId: "R3.A2b", state: NodeState.VERIFY, findings: "Needs verification" },
          { nodeId: "R3.A2c", state: NodeState.VERIFY, findings: "Needs verification" },
        ],
      },
      TEST_DIR
    );

    // Round 4 - Complete VERIFY nodes with terminal states (70% allowed)
    // R3.A1b, R3.A1c, R3.A2b, R3.A2c each need 1 child
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R4.A1b1", parent: "R3.A1b", title: "A1b1", plannedAction: "A1b1" },
          { id: "R4.A1c1", parent: "R3.A1c", title: "A1c1", plannedAction: "A1c1" },
          { id: "R4.A2b1", parent: "R3.A2b", title: "A2b1", plannedAction: "A2b1" },
          { id: "R4.A2c1", parent: "R3.A2c", title: "A2c1", plannedAction: "A2c1" },
        ],
      },
      TEST_DIR
    );
    // 70% terminal allowed in round 4 - we have 2 terminal out of 4 = 50%
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R4.A1b1", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
          { nodeId: "R4.A1c1", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
          { nodeId: "R4.A2b1", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
          { nodeId: "R4.A2c1", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
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

    // Round 2 - DRILL requires 3 children, 35% terminal allowed (1 out of 3 = 33%)
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
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.DRILL, findings: "More" },
          { nodeId: "R2.A2", state: NodeState.DRILL, findings: "More" },
          { nodeId: "R2.A3", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
        ],
      },
      TEST_DIR
    );

    // Round 3 - 50% terminal allowed
    // Batch 1: 1 VALID + 1 SPEC = 2 terminal, need 1 non-terminal = 67% > 50%, so use 1 terminal
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "A1a", plannedAction: "A1a" },
          { id: "R3.A1b", parent: "R2.A1", title: "A1b", plannedAction: "A1b" },
          { id: "R3.A1c", parent: "R2.A1", title: "A1c", plannedAction: "A1c" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.VALID, findings: "Found it", evidence: "This is a valid solution because it meets all requirements and has been verified through testing" },
          { nodeId: "R3.A1b", state: NodeState.VERIFY, findings: "Check" },
          { nodeId: "R3.A1c", state: NodeState.VERIFY, findings: "Check" },
        ],
      },
      TEST_DIR
    );

    // Batch 2: 1 SPEC + 1 DEAD = 2 terminal, need 1 non-terminal = 67% > 50%
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A2a", parent: "R2.A2", title: "A2a", plannedAction: "A2a" },
          { id: "R3.A2b", parent: "R2.A2", title: "A2b", plannedAction: "A2b" },
          { id: "R3.A2c", parent: "R2.A2", title: "A2c", plannedAction: "A2c" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A2a", state: NodeState.SPEC, findings: "Theory", evidence: "This is a speculative theory that requires further investigation to confirm or refute" },
          { nodeId: "R3.A2b", state: NodeState.VERIFY, findings: "Check" },
          { nodeId: "R3.A2c", state: NodeState.VERIFY, findings: "Check" },
        ],
      },
      TEST_DIR
    );

    // Round 4 - Complete VERIFY nodes (70% terminal allowed)
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R4.A1b1", parent: "R3.A1b", title: "A1b1", plannedAction: "A1b1" },
          { id: "R4.A1c1", parent: "R3.A1c", title: "A1c1", plannedAction: "A1c1" },
          { id: "R4.A2b1", parent: "R3.A2b", title: "A2b1", plannedAction: "A2b1" },
          { id: "R4.A2c1", parent: "R3.A2c", title: "A2c1", plannedAction: "A2c1" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R4.A1b1", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
          { nodeId: "R4.A1c1", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
          { nodeId: "R4.A2b1", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
          { nodeId: "R4.A2c1", state: NodeState.DEAD, findings: "Dead", evidence: "This path is a dead end because the approach fundamentally cannot work due to technical limitations" },
        ],
      },
      TEST_DIR
    );

    const result = await handleEnd({ sessionId }, TEST_DIR);

    expect(result.solutions).toHaveLength(1);
    expect(result.theories).toHaveLength(1);
    expect(result.theories[0].nodeId).toBe("R3.A2a");
  });
});
