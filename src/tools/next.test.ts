import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "fs";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { handleCommit } from "./commit";
import { handleEnd } from "./end";
import { handleNext } from "./next";
import { NodeState } from "../types";

const TEST_DIR = "./test-agent-native-investigations";
const GRAPH_DIR = "./test-agent-native-graphs";

describe("agent-native orchestration", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(GRAPH_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    rmSync(GRAPH_DIR, { recursive: true, force: true });
  });

  test("tot_next emits root proposal and combination-aware next paths", async () => {
    const start = await handleStart({ query: "Explore config combinations" }, TEST_DIR);

    const first = await handleNext({ sessionId: start.sessionId, strategy: "balanced", maxTasks: 4 }, TEST_DIR);
    expect(first.status).toBe("OK");
    expect(first.nextCall).toBe("tot_propose");
    expect(first.proposePayload?.nodes).toEqual([
      {
        id: "R1.A",
        parent: null,
        title: "Root investigation",
        plannedAction: "Map the problem, list major solution/search paths, and identify dimensions to branch: Explore config combinations",
      },
    ]);

    await handlePropose(first.proposePayload!, TEST_DIR);
    await handleCommit(
      {
        sessionId: start.sessionId,
        results: [
          {
            nodeId: "R1.A",
            state: NodeState.EXPLORE,
            findings: "Summary: root\nEvidence: x\nDecision: branch\nConfidence: medium\nRisks: none\n\n## References\n- src/index.ts",
            agentId: "e000001",
          },
        ],
      },
      TEST_DIR,
    );

    const next = await handleNext(
      {
        sessionId: start.sessionId,
        strategy: "exhaustive",
        maxTasks: 4,
        dimensions: { runtime: ["bun", "node"], storage: ["tmp", "repo"] },
      },
      TEST_DIR,
    );

    expect(next.nextCall).toBe("tot_propose");
    expect(next.tasks.length).toBeGreaterThanOrEqual(2);
    expect(next.coverage?.total).toBe(4);
    expect(next.proposePayload?.nodes[0].parent).toBe("R1.A");
    expect(next.tasks[0].plannedAction).toContain("runtime=bun");
    expect(next.instructions.some((line) => line.includes("Do not fabricate"))).toBe(true);
    expect(next.graph?.nodes.some((node) => node.id === "R1.A")).toBe(true);
    expect(next.canEnd).toBe(false);
    expect(next.canEndReason).toContain("Round 1 < 5");
  });

  test("tot_next smoke mode uses semantic titles from findings", async () => {
    const start = await handleStart({ query: "Semantic titles" }, TEST_DIR);
    const sessionId = start.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "Root", plannedAction: "root" }] }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [{
        nodeId: "R1.A",
        state: NodeState.EXPLORE,
        findings: "Summary: root\nBranches: GPU training, data pipeline, evaluation harness\n\n## References\n- src/index.ts",
      }],
    }, TEST_DIR);

    const next = await handleNext({ sessionId, mode: "smoke", maxTasks: 8 }, TEST_DIR);

    expect(next.tasks.length).toBe(1);
    expect(next.tasks[0].title).toBe("GPU training");
    expect(next.tasks[0].plannedAction).toBe("GPU training");
    expect(next.tasks[0].expectedCommit.state).toBe(NodeState.FOUND);
  });

  test("smoke mode can finish at round 2", async () => {
    const start = await handleStart({ query: "Smoke finish" }, TEST_DIR);
    const sessionId = start.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "Root", plannedAction: "root" }] }, TEST_DIR);
    await handleCommit({ sessionId, minRounds: 2, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "Branches: direct candidate" }] }, TEST_DIR);
    await handlePropose({ sessionId, nodes: [{ id: "R2.Aa", parent: "R1.A", title: "Direct candidate", plannedAction: "try direct" }] }, TEST_DIR);
    const found = await handleCommit({ sessionId, minRounds: 2, allowEarlyTerminal: true, results: [{ nodeId: "R2.Aa", state: NodeState.FOUND, findings: "solution" }] }, TEST_DIR);

    expect(found.pendingExplore).toEqual([]);
    expect(found.message).toContain("FOUND nodes need VERIFY");

    await handlePropose({ sessionId, nodes: [{ id: "R3.Aaa", parent: "R2.Aa", title: "Verify direct", plannedAction: "verify" }] }, TEST_DIR);
    const verify = await handleCommit({ sessionId, minRounds: 2, results: [{ nodeId: "R3.Aaa", state: NodeState.VERIFY, findings: "verified" }] }, TEST_DIR);

    expect(verify.canEnd).toBe(true);
    expect(verify.pendingExplore).toEqual([]);
    expect(verify.pendingNonTerminal).toEqual([]);
  });

  test("tot_end returns and persists JSON and DOT graphs", async () => {
    const start = await handleStart({ query: "Complete graph" }, TEST_DIR);
    const sessionId = start.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "root" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "root", agentId: "f000001" }] }, TEST_DIR);

    await handlePropose({ sessionId, nodes: [
      { id: "R2.A1", parent: "R1.A", title: "R2a", plannedAction: "a" },
      { id: "R2.A2", parent: "R1.A", title: "R2b", plannedAction: "b" },
    ] }, TEST_DIR);
    await handleCommit({ sessionId, results: [
      { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "a", agentId: "f000002" },
      { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "b", agentId: "f000003" },
    ] }, TEST_DIR);

    await handlePropose({ sessionId, nodes: [
      { id: "R3.A1a", parent: "R2.A1", title: "R3a", plannedAction: "a" },
      { id: "R3.A1b", parent: "R2.A1", title: "R3b", plannedAction: "b" },
      { id: "R3.A2a", parent: "R2.A2", title: "R3c", plannedAction: "c" },
      { id: "R3.A2b", parent: "R2.A2", title: "R3d", plannedAction: "d" },
    ] }, TEST_DIR);
    await handleCommit({ sessionId, results: [
      { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "a", agentId: "f000004" },
      { nodeId: "R3.A1b", state: NodeState.EXHAUST, findings: "b", agentId: "f000005" },
      { nodeId: "R3.A2a", state: NodeState.EXHAUST, findings: "c", agentId: "f000006" },
      { nodeId: "R3.A2b", state: NodeState.EXHAUST, findings: "d", agentId: "f000007" },
    ] }, TEST_DIR);

    await handlePropose({ sessionId, nodes: [
      { id: "R4.A1a1", parent: "R3.A1a", title: "Found", plannedAction: "found" },
      { id: "R4.A1a2", parent: "R3.A1a", title: "Dead", plannedAction: "dead" },
      { id: "R4.A1b1", parent: "R3.A1b", title: "Dead", plannedAction: "dead" },
      { id: "R4.A2a1", parent: "R3.A2a", title: "Dead", plannedAction: "dead" },
      { id: "R4.A2b1", parent: "R3.A2b", title: "Dead", plannedAction: "dead" },
    ] }, TEST_DIR);
    await handleCommit({ sessionId, results: [
      { nodeId: "R4.A1a1", state: NodeState.FOUND, findings: "solution", agentId: "f000008" },
      { nodeId: "R4.A1a2", state: NodeState.DEAD, findings: "dead", agentId: "f000009" },
      { nodeId: "R4.A1b1", state: NodeState.DEAD, findings: "dead", agentId: "f000010" },
      { nodeId: "R4.A2a1", state: NodeState.DEAD, findings: "dead", agentId: "f000011" },
      { nodeId: "R4.A2b1", state: NodeState.DEAD, findings: "dead", agentId: "f000012" },
    ] }, TEST_DIR);

    await handlePropose({ sessionId, nodes: [{ id: "R5.A1a1a", parent: "R4.A1a1", title: "Verify", plannedAction: "verify" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R5.A1a1a", state: NodeState.VERIFY, findings: "verified", agentId: "f000013" }] }, TEST_DIR);

    const result = await handleEnd({ sessionId }, TEST_DIR, GRAPH_DIR);

    expect(result.status).toBe("OK");
    expect(result.graph.nodes.length).toBe(result.totalNodes);
    expect(result.graph.edges.some((edge) => edge.from === "R4.A1a1" && edge.to === "R5.A1a1a")).toBe(true);
    expect(result.finalDot).toContain("digraph Investigation");
    expect(result.graphPath).toContain("test-agent-native-graphs");
    expect(result.dotPath).toContain("test-agent-native-graphs");
    expect(existsSync(result.graphPath)).toBe(true);
    expect(existsSync(result.dotPath)).toBe(true);
  });
});
