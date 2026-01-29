import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, mkdirSync } from "fs";
import { Validator, getIncompleteExploreNodes } from "./validation";
import { InvestigationState } from "./investigation";
import { NodeState } from "../types";

const TEST_DIR = "./test-validation";

describe("getIncompleteExploreNodes", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("returns empty array when all EXPLORE nodes have 2+ children", () => {
    const state = InvestigationState.create("Test query", 1, TEST_DIR);

    // Add root with 2 children
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.EXPLORE,
      title: "Root",
      findings: "Test",
      children: [],
      round: 1,
    });

    state.addNode({
      id: "R2.A1",
      parent: "R1.A",
      state: NodeState.DEAD,
      title: "Child 1",
      findings: "Dead end",
      children: [],
      round: 2,
    });

    state.addNode({
      id: "R2.A2",
      parent: "R1.A",
      state: NodeState.DEAD,
      title: "Child 2",
      findings: "Dead end",
      children: [],
      round: 2,
    });

    const incomplete = getIncompleteExploreNodes(state);
    expect(incomplete).toEqual([]);
  });

  test("returns nodes that have 0 children", () => {
    const state = InvestigationState.create("Test query", 1, TEST_DIR);

    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.EXPLORE,
      title: "Root",
      findings: "Test",
      children: [],
      round: 1,
    });

    const incomplete = getIncompleteExploreNodes(state);
    expect(incomplete).toEqual([
      { nodeId: "R1.A", has: 0, needs: 2 }
    ]);
  });

  test("returns nodes that have 1 child", () => {
    const state = InvestigationState.create("Test query", 1, TEST_DIR);

    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.EXPLORE,
      title: "Root",
      findings: "Test",
      children: [],
      round: 1,
    });

    state.addNode({
      id: "R2.A1",
      parent: "R1.A",
      state: NodeState.DEAD,
      title: "Child 1",
      findings: "Dead end",
      children: [],
      round: 2,
    });

    const incomplete = getIncompleteExploreNodes(state);
    expect(incomplete).toEqual([
      { nodeId: "R1.A", has: 1, needs: 2 }
    ]);
  });

  test("does not return DEAD/VERIFY nodes (terminal states)", () => {
    const state = InvestigationState.create("Test query", 1, TEST_DIR);

    // DEAD node with no children - should NOT be returned (terminal)
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DEAD,
      title: "Dead",
      findings: "Dead end",
      children: [],
      round: 1,
    });

    // VERIFY node with no children - should NOT be returned (terminal)
    state.addNode({
      id: "R1.C",
      parent: null,
      state: NodeState.VERIFY,
      title: "Verify",
      findings: "Confirmed",
      children: [],
      round: 1,
    });

    const incomplete = getIncompleteExploreNodes(state);
    expect(incomplete).toEqual([]);
  });

  test("returns FOUND nodes that need children", () => {
    const state = InvestigationState.create("Test query", 1, TEST_DIR);

    // FOUND node with no children - SHOULD be returned (needs 2 VERIFY children)
    state.addNode({
      id: "R1.B",
      parent: null,
      state: NodeState.FOUND,
      title: "Found",
      findings: "Solution",
      children: [],
      round: 1,
    });

    const incomplete = getIncompleteExploreNodes(state);
    expect(incomplete).toEqual([{ nodeId: "R1.B", has: 0, needs: 2 }]);
  });

  test("returns EXHAUST nodes that need children", () => {
    const state = InvestigationState.create("Test query", 1, TEST_DIR);

    // EXHAUST node with no children - SHOULD be returned (needs 1 DEAD child)
    state.addNode({
      id: "R1.D",
      parent: null,
      state: NodeState.EXHAUST,
      title: "Exhausted",
      findings: "Exhausted path",
      children: [],
      round: 1,
    });

    const incomplete = getIncompleteExploreNodes(state);
    expect(incomplete).toEqual([{ nodeId: "R1.D", has: 0, needs: 1 }]);
  });

  test("returns multiple incomplete EXPLORE nodes", () => {
    const state = InvestigationState.create("Test query", 1, TEST_DIR);

    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.EXPLORE,
      title: "Root",
      findings: "Test",
      children: [],
      round: 1,
    });

    state.addNode({
      id: "R2.A1",
      parent: "R1.A",
      state: NodeState.EXPLORE,
      title: "Child",
      findings: "More to explore",
      children: [],
      round: 2,
    });

    state.addNode({
      id: "R2.A2",
      parent: "R1.A",
      state: NodeState.EXPLORE,
      title: "Child 2",
      findings: "More to explore",
      children: [],
      round: 2,
    });

    const incomplete = getIncompleteExploreNodes(state);
    expect(incomplete.length).toBe(2);
    expect(incomplete).toContainEqual({ nodeId: "R2.A1", has: 0, needs: 2 });
    expect(incomplete).toContainEqual({ nodeId: "R2.A2", has: 0, needs: 2 });
  });
});
