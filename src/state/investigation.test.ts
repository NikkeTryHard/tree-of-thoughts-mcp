import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { InvestigationState } from "./investigation";
import { NodeState } from "../types";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("InvestigationState", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("creates new investigation with correct defaults", () => {
    const state = InvestigationState.create("Test query", 5, TEST_DIR);
    expect(state.data.query).toBe("Test query");
    expect(state.data.minRoots).toBe(5);
    expect(state.data.currentRound).toBe(1);
    expect(state.data.currentBatch).toBe(0);
    expect(Object.keys(state.data.nodes)).toHaveLength(0);
  });

  test("persists and loads from file", () => {
    const state = InvestigationState.create("Persist test", 5, TEST_DIR);
    const sessionId = state.data.sessionId;
    state.save();
    const loaded = InvestigationState.load(sessionId, TEST_DIR);
    expect(loaded).not.toBeNull();
    expect(loaded!.data.query).toBe("Persist test");
  });

  test("adds node correctly", () => {
    const state = InvestigationState.create("Node test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Test node",
      findings: null,
      children: [],
      round: 1,
    });
    expect(state.data.nodes["R1.A"]).toBeDefined();
    expect(state.data.nodes["R1.A"].title).toBe("Test node");
  });

  test("getNode returns node or null", () => {
    const state = InvestigationState.create("Get test", 5, TEST_DIR);
    expect(state.getNode("R1.A")).toBeNull();
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Test",
      findings: null,
      children: [],
      round: 1,
    });
    expect(state.getNode("R1.A")).not.toBeNull();
  });

  test("tracks parent-child relationships", () => {
    const state = InvestigationState.create("Relationship test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Parent",
      findings: null,
      children: [],
      round: 1,
    });
    state.addNode({
      id: "R2.A1",
      parent: "R1.A",
      state: NodeState.DRILL,
      title: "Child",
      findings: null,
      children: [],
      round: 2,
    });
    expect(state.data.nodes["R1.A"].children).toContain("R2.A1");
  });

  test("tracks nodes awaiting confirmation", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);

    state.addNode({
      id: "R3.A1",
      parent: null,
      state: NodeState.VALID_PENDING,
      title: "Pending validation",
      findings: "Found something",
      children: [],
      round: 3,
    });

    const pending = state.getNodesAwaitingConfirmation();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("R3.A1");
  });

  test("confirms pending validation when child is VALID", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);

    state.addNode({
      id: "R3.A1",
      parent: null,
      state: NodeState.VALID_PENDING,
      title: "Pending",
      findings: "Found",
      children: [],
      round: 3,
    });

    // Add confirming child
    state.addNode({
      id: "R4.A1a",
      parent: "R3.A1",
      state: NodeState.VALID,
      title: "Confirmed",
      findings: "Verified",
      children: [],
      round: 4,
    });

    state.processConfirmations();

    const node = state.getNode("R3.A1");
    expect(node?.state).toBe(NodeState.VALID);
  });

  test("reverts pending validation when child is DEAD", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);

    state.addNode({
      id: "R3.A1",
      parent: null,
      state: NodeState.VALID_PENDING,
      title: "Pending",
      findings: "Found",
      children: [],
      round: 3,
    });

    // Add rejecting child
    state.addNode({
      id: "R4.A1a",
      parent: "R3.A1",
      state: NodeState.DEAD,
      title: "Rejected",
      findings: "Actually not valid",
      children: [],
      round: 4,
    });

    state.processConfirmations();

    const node = state.getNode("R3.A1");
    expect(node?.state).toBe(NodeState.DRILL); // Reverted to DRILL for more exploration
  });
});
