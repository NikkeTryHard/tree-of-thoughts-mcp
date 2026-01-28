import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, mkdirSync } from "fs";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { handleCommit } from "./commit";
import { NodeState } from "../types";

const TEST_DIR = "./test-commit-investigations";

describe("depth enforcement", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("converts FOUND to EXPLORE before round 3", async () => {
    const startResult = await handleStart({ query: "test", minRoots: 1 }, TEST_DIR);
    const sessionId = startResult.sessionId;

    await handlePropose(
      {
        sessionId,
        nodes: [{ id: "R1.A", parent: null, title: "Root", plannedAction: "test" }],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x" }],
      },
      TEST_DIR,
    );

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "Child1", plannedAction: "test" },
          { id: "R2.A2", parent: "R1.A", title: "Child2", plannedAction: "test" },
        ],
      },
      TEST_DIR,
    );

    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.FOUND, findings: "solution" },
          { nodeId: "R2.A2", state: NodeState.DEAD, findings: "dead" },
        ],
      },
      TEST_DIR,
    );

    expect(result.status).toBe("OK");
    expect(result.warnings.some((w) => w.includes("DEPTH_ENFORCED"))).toBe(true);
    expect(result.pendingExplore).toContain("R2.A1");
  });

  it("allows FOUND at round 3+", async () => {
    const startResult = await handleStart({ query: "test", minRoots: 1 }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Build to R3
    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x" }] }, TEST_DIR);

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "R2a", plannedAction: "t" },
          { id: "R2.A2", parent: "R1.A", title: "R2b", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x" },
          { nodeId: "R2.A2", state: NodeState.DEAD, findings: "x" },
        ],
      },
      TEST_DIR,
    );

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "R3a", plannedAction: "t" },
          { id: "R3.A1b", parent: "R2.A1", title: "R3b", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );
    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.FOUND, findings: "solution" },
          { nodeId: "R3.A1b", state: NodeState.DEAD, findings: "x" },
        ],
      },
      TEST_DIR,
    );

    expect(result.warnings.some((w) => w.includes("DEPTH_ENFORCED"))).toBe(false);
  });
});

describe("FOUND requires VERIFY", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("FOUND node appears in pendingExplore until VERIFY child added", async () => {
    const startResult = await handleStart({ query: "test", minRoots: 1 }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Build to R3 FOUND
    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x" }] }, TEST_DIR);

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "R2a", plannedAction: "t" },
          { id: "R2.A2", parent: "R1.A", title: "R2b", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x" },
          { nodeId: "R2.A2", state: NodeState.DEAD, findings: "x" },
        ],
      },
      TEST_DIR,
    );

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "R3a", plannedAction: "t" },
          { id: "R3.A1b", parent: "R2.A1", title: "R3b", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );
    const result1 = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.FOUND, findings: "solution" },
          { nodeId: "R3.A1b", state: NodeState.DEAD, findings: "x" },
        ],
      },
      TEST_DIR,
    );

    // FOUND should need VERIFY child
    expect(result1.pendingExplore).toContain("R3.A1a");
    expect(result1.canEnd).toBe(false);

    // Add VERIFY child
    await handlePropose({ sessionId, nodes: [{ id: "R4.A1a1", parent: "R3.A1a", title: "Verify", plannedAction: "verify" }] }, TEST_DIR);
    const result2 = await handleCommit({ sessionId, results: [{ nodeId: "R4.A1a1", state: NodeState.VERIFY, findings: "confirmed" }] }, TEST_DIR);

    expect(result2.pendingExplore).not.toContain("R3.A1a");
    expect(result2.canEnd).toBe(true);
  });
});
