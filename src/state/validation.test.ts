import { describe, expect, test } from "bun:test";
import { Validator } from "./validation";
import { InvestigationState } from "./investigation";
import { NodeState, type ProposedNode } from "../types";

const TEST_DIR = "./test-investigations";

describe("Validator", () => {
  test("rejects node with non-existent parent", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    const proposed: ProposedNode = {
      id: "R2.A1",
      parent: "R1.A",
      title: "Test",
      plannedAction: "Do something",
    };
    const errors = Validator.validateProposedNode(proposed, state);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe("PARENT_NOT_FOUND");
  });

  test("rejects node with terminal parent", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.VALID,
      title: "Parent",
      findings: null,
      children: [],
      round: 1,
    });
    const proposed: ProposedNode = {
      id: "R2.A1",
      parent: "R1.A",
      title: "Child",
      plannedAction: "Do something",
    };
    const errors = Validator.validateProposedNode(proposed, state);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe("TERMINAL_PARENT");
  });

  test("accepts node with DRILL parent", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Parent",
      findings: null,
      children: [],
      round: 1,
    });
    const proposed: ProposedNode = {
      id: "R2.A1",
      parent: "R1.A",
      title: "Child",
      plannedAction: "Do something",
    };
    const errors = Validator.validateProposedNode(proposed, state);
    expect(errors).toHaveLength(0);
  });

  test("rejects duplicate node ID", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Existing",
      findings: null,
      children: [],
      round: 1,
    });
    const proposed: ProposedNode = {
      id: "R1.A",
      parent: null,
      title: "Duplicate",
      plannedAction: "Do something",
    };
    const errors = Validator.validateProposedNode(proposed, state);
    expect(errors[0].error).toBe("DUPLICATE_ID");
  });

  test("rejects reclassification of node with children to terminal", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Parent",
      findings: null,
      children: ["R2.A1"],
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
    const errors = Validator.validateReclassification("R1.A", NodeState.DEAD, state);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe("HAS_CHILDREN");
  });

  test("allows reclassification of terminal to active", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DEAD,
      title: "Dead node",
      findings: null,
      children: [],
      round: 1,
    });
    const errors = Validator.validateReclassification("R1.A", NodeState.DRILL, state);
    expect(errors).toHaveLength(0);
  });

  test("validates DRILL nodes have enough children at round end", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Drill with 1 child",
      findings: null,
      children: ["R2.A1"],
      round: 1,
    });
    const errors = Validator.validateRoundCompletion(state, 1);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe("INSUFFICIENT_CHILDREN");
  });

  test("validates investigation can end", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.data.currentRound = 2;
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.VALID,
      title: "Valid",
      findings: null,
      children: [],
      round: 1,
    });
    const result = Validator.canEndInvestigation(state);
    expect(result.canEnd).toBe(false);
    expect(result.reason).toContain("round");
  });

  test("allows end when round >= 3 and all terminal", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.data.currentRound = 3;
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.VALID,
      title: "Valid",
      findings: "Found it",
      children: [],
      round: 1,
    });
    const result = Validator.canEndInvestigation(state);
    expect(result.canEnd).toBe(true);
  });
});
