import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, mkdirSync } from "fs";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { handleCommit } from "./commit";
import { NodeState } from "../types";

const TEST_DIR = "./test-commit-investigations";

describe("anti-gaming: timing", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("warns SUSPICIOUS if commit within 10 seconds of propose", async () => {
    const start = await handleStart({ query: "Test" }, TEST_DIR);

    await handlePropose({
      sessionId: start.sessionId,
      nodes: [{ id: "R1.A", parent: null, title: "Test", plannedAction: "Test" }],
    }, TEST_DIR);

    // Immediate commit (no real agent work done)
    const result = await handleCommit({
      sessionId: start.sessionId,
      results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "Fake", agentId: "abc1234" }],
    }, TEST_DIR);

    expect(result.warnings.some(w => w.includes("SUSPICIOUS"))).toBe(true);
  });
});

describe("anti-gaming: agentId", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("rejects MISSING_AGENT if no agentId provided", async () => {
    const start = await handleStart({ query: "Test" }, TEST_DIR);

    await handlePropose({
      sessionId: start.sessionId,
      nodes: [{ id: "R1.A", parent: null, title: "Test", plannedAction: "Test" }],
    }, TEST_DIR);

    // Commit without agentId - should be REJECTED
    const result = await handleCommit({
      sessionId: start.sessionId,
      results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "Test" }],
    }, TEST_DIR);

    expect(result.status).toBe("REJECTED");
    expect(result.errors.some(e => e.error === "MISSING_AGENT")).toBe(true);
  });

  it("rejects REUSED_AGENT if same agentId used twice", async () => {
    const start = await handleStart({ query: "Test" }, TEST_DIR);

    await handlePropose({
      sessionId: start.sessionId,
      nodes: [{ id: "R1.A", parent: null, title: "Test", plannedAction: "Test" }],
    }, TEST_DIR);

    // First commit with agentId
    await handleCommit({
      sessionId: start.sessionId,
      results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "Test", agentId: "abc1234" }],
    }, TEST_DIR);

    // Propose children
    await handlePropose({
      sessionId: start.sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "Child1", plannedAction: "Test" },
        { id: "R2.A2", parent: "R1.A", title: "Child2", plannedAction: "Test" },
      ],
    }, TEST_DIR);

    // Try to reuse the same agentId - should be REJECTED
    const result = await handleCommit({
      sessionId: start.sessionId,
      results: [
        { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "Test", agentId: "abc1234" },
        { nodeId: "R2.A2", state: NodeState.DEAD, findings: "Test", agentId: "def5678" },
      ],
    }, TEST_DIR);

    expect(result.status).toBe("REJECTED");
    expect(result.errors.some(e => e.error === "REUSED_AGENT")).toBe(true);
  });

  it("no warning if agentId provided", async () => {
    const start = await handleStart({ query: "Test" }, TEST_DIR);

    await handlePropose({
      sessionId: start.sessionId,
      nodes: [{ id: "R1.A", parent: null, title: "Test", plannedAction: "Test" }],
    }, TEST_DIR);

    const result = await handleCommit({
      sessionId: start.sessionId,
      results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "Test", agentId: "agent-123" }],
    }, TEST_DIR);

    expect(result.warnings.some(w => w.includes("MISSING_AGENT"))).toBe(false);
  });
});

describe("depth enforcement", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("converts FOUND to EXPLORE before round 4", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
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
        results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "a000001" }],
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
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "a000002" },
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "a000003" },
        ],
      },
      TEST_DIR,
    );

    // R3 - FOUND here should be converted to EXPLORE (R3 EXPLORE-only)
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "Child1", plannedAction: "test" },
          { id: "R3.A1b", parent: "R2.A1", title: "Child2", plannedAction: "test" },
        ],
      },
      TEST_DIR,
    );

    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.FOUND, findings: "solution", agentId: "a000004" },
          { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "more", agentId: "a000005" },
        ],
      },
      TEST_DIR,
    );

    expect(result.status).toBe("OK");
    // R3 EXPLORE-only rule takes precedence
    expect(result.warnings.some((w) => w.includes("R3_EXPLORE_ONLY"))).toBe(true);
    expect(result.pendingExplore).toContain("R3.A1a");
  });

  it("allows FOUND at round 4+", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Build to R4
    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "b000001" }] }, TEST_DIR);

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
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "b000002" },
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "b000003" },
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
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "x", agentId: "b000004" },
          { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "x", agentId: "b000005" },
        ],
      },
      TEST_DIR,
    );

    // R4 - FOUND should be allowed here
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R4.A1a1", parent: "R3.A1a", title: "R4a", plannedAction: "t" },
          { id: "R4.A1a2", parent: "R3.A1a", title: "R4b", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );
    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R4.A1a1", state: NodeState.FOUND, findings: "solution", agentId: "b000006" },
          { nodeId: "R4.A1a2", state: NodeState.DEAD, findings: "x", agentId: "b000007" },
        ],
      },
      TEST_DIR,
    );

    expect(result.warnings.some((w) => w.includes("DEPTH_ENFORCED"))).toBe(false);
  });

  it("converts EXHAUST to EXPLORE at R2", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "e000001" }] }, TEST_DIR);

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

    // Try EXHAUST at R2 - should convert to EXPLORE
    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.EXHAUST, findings: "exhausted", agentId: "e000002" },
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "e000003" },
        ],
      },
      TEST_DIR,
    );

    expect(result.status).toBe("OK");
    expect(result.warnings.some((w) => w.includes("EXHAUST_ENFORCED"))).toBe(true);
    expect(result.pendingExplore).toContain("R2.A1");
  });

  it("converts EXHAUST to EXPLORE at R3 (R3 EXPLORE-only)", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "f000001" }] }, TEST_DIR);

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
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "f000002" },
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "f000003" },
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

    // EXHAUST at R3 should be converted to EXPLORE (R3 EXPLORE-only)
    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.EXHAUST, findings: "exhausted", agentId: "f000004" },
          { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "x", agentId: "f000005" },
        ],
      },
      TEST_DIR,
    );

    expect(result.status).toBe("OK");
    expect(result.warnings.some((w) => w.includes("R3_EXPLORE_ONLY"))).toBe(true);
    expect(result.pendingExplore).toContain("R3.A1a");
  });

  it("allows EXHAUST at R4", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "ex4_001" }] }, TEST_DIR);

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
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "ex4_002" },
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "ex4_003" },
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
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "x", agentId: "ex4_004" },
          { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "x", agentId: "ex4_005" },
        ],
      },
      TEST_DIR,
    );

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R4.A1a1", parent: "R3.A1a", title: "R4a", plannedAction: "t" },
          { id: "R4.A1a2", parent: "R3.A1a", title: "R4b", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );

    // EXHAUST at R4 should be allowed
    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R4.A1a1", state: NodeState.EXHAUST, findings: "exhausted", agentId: "ex4_006" },
          { nodeId: "R4.A1a2", state: NodeState.EXPLORE, findings: "x", agentId: "ex4_007" },
        ],
      },
      TEST_DIR,
    );

    expect(result.status).toBe("OK");
    expect(result.warnings.some((w) => w.includes("EXHAUST_ENFORCED"))).toBe(false);
    expect(result.warnings.some((w) => w.includes("R3_EXPLORE_ONLY"))).toBe(false);
  });

  it("converts DEAD to EXPLORE at R2", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "g000001" }] }, TEST_DIR);

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

    // Try DEAD at R2 - should convert to EXPLORE
    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.DEAD, findings: "dead", agentId: "g000002" },
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "g000003" },
        ],
      },
      TEST_DIR,
    );

    expect(result.status).toBe("OK");
    expect(result.warnings.some((w) => w.includes("DEAD_ENFORCED") && w.includes("DEAD→EXPLORE"))).toBe(true);
    expect(result.pendingExplore).toContain("R2.A1");
  });

  it("converts DEAD to EXPLORE at R3 (R3 EXPLORE-only)", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "h000001" }] }, TEST_DIR);

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
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "h000002" },
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "h000003" },
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

    // Try DEAD at R3 - should convert to EXPLORE (R3 EXPLORE-only)
    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.DEAD, findings: "dead", agentId: "h000004" },
          { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "x", agentId: "h000005" },
        ],
      },
      TEST_DIR,
    );

    expect(result.status).toBe("OK");
    expect(result.warnings.some((w) => w.includes("R3_EXPLORE_ONLY"))).toBe(true);
    expect(result.pendingExplore).toContain("R3.A1a");
  });

  it("allows DEAD at R4", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "i000001" }] }, TEST_DIR);

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
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "i000002" },
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "i000003" },
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
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "x", agentId: "i000004" },
          { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "x", agentId: "i000005" },
        ],
      },
      TEST_DIR,
    );

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R4.A1a1", parent: "R3.A1a", title: "R4a", plannedAction: "t" },
          { id: "R4.A1a2", parent: "R3.A1a", title: "R4b", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );

    // DEAD at R4 should be allowed
    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R4.A1a1", state: NodeState.DEAD, findings: "dead", agentId: "i000006" },
          { nodeId: "R4.A1a2", state: NodeState.DEAD, findings: "dead", agentId: "i000007" },
        ],
      },
      TEST_DIR,
    );

    expect(result.status).toBe("OK");
    expect(result.warnings.some((w) => w.includes("DEAD_ENFORCED"))).toBe(false);
  });
});

describe("FOUND requires VERIFY", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("FOUND node appears in pendingExplore until 2 VERIFY children added", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Build to R4 FOUND
    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "c000001" }] }, TEST_DIR);

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
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "c000002" },
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "c000003" },
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
          { id: "R3.A2a", parent: "R2.A2", title: "R3c", plannedAction: "t" },
          { id: "R3.A2b", parent: "R2.A2", title: "R3d", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "x", agentId: "c000004" },
          { nodeId: "R3.A1b", state: NodeState.EXHAUST, findings: "x", agentId: "c000005" },
          { nodeId: "R3.A2a", state: NodeState.EXHAUST, findings: "x", agentId: "c000006" },
          { nodeId: "R3.A2b", state: NodeState.EXHAUST, findings: "x", agentId: "c000007" },
        ],
      },
      TEST_DIR,
    );

    // R4 - FOUND is allowed here
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R4.A1a1", parent: "R3.A1a", title: "R4a", plannedAction: "t" },
          { id: "R4.A1a2", parent: "R3.A1a", title: "R4b", plannedAction: "t" },
          { id: "R4.A1b1", parent: "R3.A1b", title: "R4c", plannedAction: "t" },
          { id: "R4.A2a1", parent: "R3.A2a", title: "R4d", plannedAction: "t" },
          { id: "R4.A2b1", parent: "R3.A2b", title: "R4e", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );
    const result1 = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R4.A1a1", state: NodeState.FOUND, findings: "solution", agentId: "c000008" },
          { nodeId: "R4.A1a2", state: NodeState.DEAD, findings: "x", agentId: "c000009" },
          { nodeId: "R4.A1b1", state: NodeState.DEAD, findings: "x", agentId: "c000010" },
          { nodeId: "R4.A2a1", state: NodeState.DEAD, findings: "x", agentId: "c000011" },
          { nodeId: "R4.A2b1", state: NodeState.DEAD, findings: "x", agentId: "c000012" },
        ],
      },
      TEST_DIR,
    );

    // FOUND should need 1 VERIFY child now
    expect(result1.pendingExplore).toContain("R4.A1a1");
    expect(result1.canEnd).toBe(false);

    // Add first VERIFY child - now complete (only needs 1)
    await handlePropose({ sessionId, nodes: [{ id: "R5.A1a1a", parent: "R4.A1a1", title: "Verify1", plannedAction: "verify" }] }, TEST_DIR);
    const result2 = await handleCommit({ sessionId, results: [{ nodeId: "R5.A1a1a", state: NodeState.VERIFY, findings: "confirmed", agentId: "c000013" }] }, TEST_DIR);

    expect(result2.pendingExplore).not.toContain("R4.A1a1"); // Complete with 1 VERIFY
    expect(result2.canEnd).toBe(true);
  });
});

describe("depth enforcement at R1", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("converts EXHAUST to EXPLORE at R1", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);

    // Try EXHAUST at R1 - should convert to EXPLORE
    const result = await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R1.A", state: NodeState.EXHAUST, findings: "exhausted", agentId: "r1exhaust001" }],
      },
      TEST_DIR,
    );

    expect(result.status).toBe("OK");
    expect(result.warnings.some((w) => w.includes("EXHAUST_ENFORCED"))).toBe(true);
    expect(result.pendingExplore).toContain("R1.A");
  });

  it("converts DEAD to EXPLORE at R1", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);

    // Try DEAD at R1 - should convert to EXPLORE
    const result = await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R1.A", state: NodeState.DEAD, findings: "dead", agentId: "r1dead001" }],
      },
      TEST_DIR,
    );

    expect(result.status).toBe("OK");
    expect(result.warnings.some((w) => w.includes("DEAD_ENFORCED") && w.includes("DEAD→EXPLORE"))).toBe(true);
    expect(result.pendingExplore).toContain("R1.A");
  });
});

describe("child state validation", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("rejects EXHAUST as child of FOUND", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Build to R4 FOUND
    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "cs000001" }] }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "R2a", plannedAction: "t" },
        { id: "R2.A2", parent: "R1.A", title: "R2b", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "cs000002" },
        { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "cs000003" },
      ],
    }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R3.A1a", parent: "R2.A1", title: "R3a", plannedAction: "t" },
        { id: "R3.A1b", parent: "R2.A1", title: "R3b", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "x", agentId: "cs000004" },
        { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "x", agentId: "cs000005" },
      ],
    }, TEST_DIR);

    // R4 FOUND
    await handlePropose({
      sessionId,
      nodes: [
        { id: "R4.A1a1", parent: "R3.A1a", title: "R4a", plannedAction: "t" },
        { id: "R4.A1a2", parent: "R3.A1a", title: "R4b", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R4.A1a1", state: NodeState.FOUND, findings: "solution", agentId: "cs000006" },
        { nodeId: "R4.A1a2", state: NodeState.DEAD, findings: "x", agentId: "cs000007" },
      ],
    }, TEST_DIR);

    // Try to add EXHAUST child to FOUND - should be REJECTED
    await handlePropose({
      sessionId,
      nodes: [{ id: "R5.A1a1a", parent: "R4.A1a1", title: "Exhaust", plannedAction: "exhaust" }],
    }, TEST_DIR);
    const result = await handleCommit({
      sessionId,
      results: [{ nodeId: "R5.A1a1a", state: NodeState.EXHAUST, findings: "exhausted", agentId: "cs000008" }],
    }, TEST_DIR);

    expect(result.status).toBe("REJECTED");
    expect(result.errors.some(e => e.error === "INVALID_CHILD_STATE")).toBe(true);
    expect(result.errors.some(e => e.message.includes("EXHAUST is not a valid child of FOUND"))).toBe(true);
  });

  it("rejects FOUND as child of EXHAUST", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Build to R4 EXHAUST
    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "cs100001" }] }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "R2a", plannedAction: "t" },
        { id: "R2.A2", parent: "R1.A", title: "R2b", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "cs100002" },
        { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "cs100003" },
      ],
    }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R3.A1a", parent: "R2.A1", title: "R3a", plannedAction: "t" },
        { id: "R3.A1b", parent: "R2.A1", title: "R3b", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "x", agentId: "cs100004" },
        { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "x", agentId: "cs100005" },
      ],
    }, TEST_DIR);

    // R4 EXHAUST
    await handlePropose({
      sessionId,
      nodes: [
        { id: "R4.A1a1", parent: "R3.A1a", title: "R4a", plannedAction: "t" },
        { id: "R4.A1a2", parent: "R3.A1a", title: "R4b", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R4.A1a1", state: NodeState.EXHAUST, findings: "exhausted", agentId: "cs100006" },
        { nodeId: "R4.A1a2", state: NodeState.DEAD, findings: "x", agentId: "cs100007" },
      ],
    }, TEST_DIR);

    // Try to add FOUND child to EXHAUST - should be REJECTED
    await handlePropose({
      sessionId,
      nodes: [{ id: "R5.A1a1a", parent: "R4.A1a1", title: "Found", plannedAction: "found" }],
    }, TEST_DIR);
    const result = await handleCommit({
      sessionId,
      results: [{ nodeId: "R5.A1a1a", state: NodeState.FOUND, findings: "solution", agentId: "cs100008" }],
    }, TEST_DIR);

    expect(result.status).toBe("REJECTED");
    expect(result.errors.some(e => e.error === "INVALID_CHILD_STATE")).toBe(true);
    expect(result.errors.some(e => e.message.includes("FOUND is not a valid child of EXHAUST"))).toBe(true);
  });

  it("allows FOUND as child of FOUND", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Build to R4 FOUND
    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "cs200001" }] }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "R2a", plannedAction: "t" },
        { id: "R2.A2", parent: "R1.A", title: "R2b", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "cs200002" },
        { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "cs200003" },
      ],
    }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R3.A1a", parent: "R2.A1", title: "R3a", plannedAction: "t" },
        { id: "R3.A1b", parent: "R2.A1", title: "R3b", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "x", agentId: "cs200004" },
        { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "x", agentId: "cs200005" },
      ],
    }, TEST_DIR);

    // R4 FOUND
    await handlePropose({
      sessionId,
      nodes: [
        { id: "R4.A1a1", parent: "R3.A1a", title: "R4a", plannedAction: "t" },
        { id: "R4.A1a2", parent: "R3.A1a", title: "R4b", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R4.A1a1", state: NodeState.FOUND, findings: "solution", agentId: "cs200006" },
        { nodeId: "R4.A1a2", state: NodeState.DEAD, findings: "x", agentId: "cs200007" },
      ],
    }, TEST_DIR);

    // Add FOUND child to FOUND - should be allowed
    await handlePropose({
      sessionId,
      nodes: [{ id: "R5.A1a1a", parent: "R4.A1a1", title: "Found2", plannedAction: "found" }],
    }, TEST_DIR);
    const result = await handleCommit({
      sessionId,
      results: [{ nodeId: "R5.A1a1a", state: NodeState.FOUND, findings: "refined solution", agentId: "cs200008" }],
    }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.errors.some(e => e.error === "INVALID_CHILD_STATE")).toBe(false);
  });
});

describe("VERIFY parent validation", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("VERIFY as child of non-FOUND parent still commits but FOUND parent requires VERIFY children", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Build to R4 with FOUND node
    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "v000001" }] }, TEST_DIR);

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
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "v000002" },
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "v000003" },
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
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "x", agentId: "v000004" },
          { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "x", agentId: "v000005" },
        ],
      },
      TEST_DIR,
    );

    // R4 with FOUND
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R4.A1a1", parent: "R3.A1a", title: "R4a", plannedAction: "t" },
          { id: "R4.A1a2", parent: "R3.A1a", title: "R4b", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );
    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R4.A1a1", state: NodeState.FOUND, findings: "solution", agentId: "v000006" },
          { nodeId: "R4.A1a2", state: NodeState.DEAD, findings: "x", agentId: "v000007" },
        ],
      },
      TEST_DIR,
    );

    // FOUND node needs VERIFY children
    expect(result.pendingExplore).toContain("R4.A1a1");
    expect(result.canEnd).toBe(false);
  });
});
