import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { handleStart } from "./start";
import { handleStep } from "./step";
import { handleEnd } from "./end";
import { NodeState } from "../types";

const TEST_DIR = "./test-step-investigations";
const GRAPH_DIR = "./test-step-graphs";

describe("tot_step", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(GRAPH_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    rmSync(GRAPH_DIR, { recursive: true, force: true });
  });

  test("drives compact smoke workflow with persisted defaults", async () => {
    const start = await handleStart({ query: "Smoke", mode: "smoke" }, TEST_DIR);
    const sessionId = start.sessionId;

    const first = await handleStep({ sessionId }, TEST_DIR);
    expect(first.nextCall).toBe("work");
    expect(first.tasks[0].stateHint).toBe(NodeState.EXPLORE);
    expect(first.graph).toMatchObject({ totalNodes: 0, currentRound: 1 });
    expect("next" in first).toBe(false);

    const root = first.tasks[0];
    const afterRoot = await handleStep({
      sessionId,
      results: [{ nodeId: root.id, state: NodeState.EXPLORE, findings: "Branches: direct answer" }],
    }, TEST_DIR);
    expect(afterRoot.tasks[0].stateHint).toBe(NodeState.FOUND);

    const foundTask = afterRoot.tasks[0];
    const afterFound = await handleStep({
      sessionId,
      results: [{ nodeId: foundTask.id, state: NodeState.FOUND, findings: "Answer" }],
    }, TEST_DIR);
    expect(afterFound.pending.some((node) => node.state === NodeState.EXPLORE)).toBe(false);
    expect(afterFound.tasks[0].stateHint).toBe(NodeState.VERIFY);

    const verifyTask = afterFound.tasks[0];
    const afterVerify = await handleStep({
      sessionId,
      results: [{ nodeId: verifyTask.id, state: NodeState.VERIFY, findings: "Verified" }],
    }, TEST_DIR);
    expect(afterVerify.canEnd).toBe(true);
    expect(afterVerify.nextCall).toBe("tot_end");

    const end = await handleEnd({ sessionId }, TEST_DIR, GRAPH_DIR);
    expect(end.status).toBe("OK");
    expect(end.minRounds).toBe(2);
    expect(end.totalNodes).toBe(3);
  });

  test("can auto-propose caller supplied node ids", async () => {
    const start = await handleStart({ query: "Auto", mode: "smoke" }, TEST_DIR);

    const result = await handleStep({
      sessionId: start.sessionId,
      results: [{ nodeId: "R1.A", state: NodeState.FOUND, findings: "Direct" }],
    }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.tasks[0].stateHint).toBe(NodeState.VERIFY);
  });
});
