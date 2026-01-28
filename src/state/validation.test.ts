import { describe, expect, test } from "bun:test";
import { Validator } from "./validation";
import { InvestigationState } from "./investigation";
import { NodeState, isPendingState, type ProposedNode } from "../types";

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

  test("allows end when round >= 3 and all terminal with sufficient quality", () => {
    const state = InvestigationState.create("Test", 1, TEST_DIR);
    state.data.currentRound = 4;

    // Build a proper investigation tree that meets quality threshold
    // Depth 4, branching factor 3, balanced DEAD/VALID ratio
    state.addNode({ id: "R1.A", parent: null, state: NodeState.DRILL, title: "A", findings: null, children: [], round: 1 });
    state.addNode({ id: "R2.A1", parent: "R1.A", state: NodeState.DRILL, title: "A1", findings: null, children: [], round: 2 });
    state.addNode({ id: "R2.A2", parent: "R1.A", state: NodeState.DEAD, title: "A2", findings: "Dead", children: [], round: 2 });
    state.addNode({ id: "R2.A3", parent: "R1.A", state: NodeState.DEAD, title: "A3", findings: "Dead", children: [], round: 2 });
    state.addNode({ id: "R3.A1a", parent: "R2.A1", state: NodeState.DRILL, title: "A1a", findings: null, children: [], round: 3 });
    state.addNode({ id: "R3.A1b", parent: "R2.A1", state: NodeState.DEAD, title: "A1b", findings: "Dead", children: [], round: 3 });
    state.addNode({ id: "R3.A1c", parent: "R2.A1", state: NodeState.DEAD, title: "A1c", findings: "Dead", children: [], round: 3 });
    state.addNode({ id: "R4.A1a1", parent: "R3.A1a", state: NodeState.VALID, title: "A1a1", findings: "Found", children: [], round: 4 });
    state.addNode({ id: "R4.A1a2", parent: "R3.A1a", state: NodeState.DEAD, title: "A1a2", findings: "Dead", children: [], round: 4 });
    state.addNode({ id: "R4.A1a3", parent: "R3.A1a", state: NodeState.DEAD, title: "A1a3", findings: "Dead", children: [], round: 4 });

    const result = Validator.canEndInvestigation(state);
    expect(result.canEnd).toBe(true);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0.5);
  });
});

describe("Terminal Ratio Validation", () => {
  test("rejects batch with >35% terminal in round 2", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 2;

    // 3 nodes, all terminal = 100% > 35% limit
    const results = [
      { nodeId: "R2.A1", state: NodeState.DEAD },
      { nodeId: "R2.A2", state: NodeState.DEAD },
      { nodeId: "R2.A3", state: NodeState.DEAD },
    ];

    const errors = Validator.validateTerminalRatio(state, results);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe("TERMINAL_RATIO_EXCEEDED");
  });

  test("allows batch with <=35% terminal in round 2", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 2;

    // 1 terminal out of 3 = 33%
    const results = [
      { nodeId: "R2.A1", state: NodeState.DRILL },
      { nodeId: "R2.A2", state: NodeState.DRILL },
      { nodeId: "R2.A3", state: NodeState.DEAD },
    ];

    const errors = Validator.validateTerminalRatio(state, results);
    expect(errors.length).toBe(0);
  });

  test("allows 0% terminal in round 1", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 1;

    const results = [
      { nodeId: "R1.A", state: NodeState.DRILL },
      { nodeId: "R1.B", state: NodeState.DRILL },
    ];

    const errors = Validator.validateTerminalRatio(state, results);
    expect(errors.length).toBe(0);
  });

  test("rejects any terminal in round 1 except DEAD", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 1;

    // Round 1 allows 0% terminal (DEAD is still terminal)
    const results = [
      { nodeId: "R1.A", state: NodeState.DEAD },
    ];

    const errors = Validator.validateTerminalRatio(state, results);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe("TERMINAL_RATIO_EXCEEDED");
  });

  test("allows 50% terminal in round 3", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 3;

    // 2 terminal out of 4 = 50%
    const results = [
      { nodeId: "R3.A1", state: NodeState.DRILL },
      { nodeId: "R3.A2", state: NodeState.DRILL },
      { nodeId: "R3.A3", state: NodeState.DEAD },
      { nodeId: "R3.A4", state: NodeState.VALID },
    ];

    const errors = Validator.validateTerminalRatio(state, results);
    expect(errors.length).toBe(0);
  });

  test("allows 70% terminal in round 4+", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 5;

    // 7 terminal out of 10 = 70%
    const results = [
      { nodeId: "R5.A1", state: NodeState.DRILL },
      { nodeId: "R5.A2", state: NodeState.DRILL },
      { nodeId: "R5.A3", state: NodeState.DRILL },
      { nodeId: "R5.A4", state: NodeState.DEAD },
      { nodeId: "R5.A5", state: NodeState.DEAD },
      { nodeId: "R5.A6", state: NodeState.DEAD },
      { nodeId: "R5.A7", state: NodeState.DEAD },
      { nodeId: "R5.A8", state: NodeState.VALID },
      { nodeId: "R5.A9", state: NodeState.VALID },
      { nodeId: "R5.A10", state: NodeState.VALID },
    ];

    const errors = Validator.validateTerminalRatio(state, results);
    expect(errors.length).toBe(0);
  });

  test("treats VALID_PENDING as pending (counts toward terminal ratio)", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 2;

    // All VALID_PENDING = 100% pending > 35% limit
    const results = [
      { nodeId: "R2.A1", state: NodeState.VALID_PENDING },
      { nodeId: "R2.A2", state: NodeState.VALID_PENDING },
      { nodeId: "R2.A3", state: NodeState.VALID_PENDING },
    ];

    const errors = Validator.validateTerminalRatio(state, results);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe("TERMINAL_RATIO_EXCEEDED");
  });
});

describe("State Availability Validation", () => {
  test("rejects VALID state before round 3", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 2;

    const results = [{ nodeId: "R2.A1", state: NodeState.VALID }];
    const errors = Validator.validateStateAvailability(state, results);

    expect(errors.length).toBe(1);
    expect(errors[0].error).toBe("STATE_LOCKED");
  });

  test("rejects VALID_PENDING before round 3", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 2;

    const results = [{ nodeId: "R2.A1", state: NodeState.VALID_PENDING }];
    const errors = Validator.validateStateAvailability(state, results);

    expect(errors.length).toBe(1);
    expect(errors[0].error).toBe("STATE_LOCKED");
  });

  test("rejects SPEC before round 3", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 2;

    const results = [{ nodeId: "R2.A1", state: NodeState.SPEC }];
    const errors = Validator.validateStateAvailability(state, results);

    expect(errors.length).toBe(1);
    expect(errors[0].error).toBe("STATE_LOCKED");
  });

  test("allows VALID_PENDING at round 3+", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 3;

    const results = [{ nodeId: "R3.A1", state: NodeState.VALID_PENDING }];
    const errors = Validator.validateStateAvailability(state, results);

    expect(errors.length).toBe(0);
  });

  test("allows VALID at round 3+", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 3;

    const results = [{ nodeId: "R3.A1", state: NodeState.VALID }];
    const errors = Validator.validateStateAvailability(state, results);

    expect(errors.length).toBe(0);
  });

  test("allows SPEC at round 3+", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 4;

    const results = [{ nodeId: "R4.A1", state: NodeState.SPEC }];
    const errors = Validator.validateStateAvailability(state, results);

    expect(errors.length).toBe(0);
  });

  test("allows DEAD at any round", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 1;

    const results = [{ nodeId: "R1.A", state: NodeState.DEAD }];
    const errors = Validator.validateStateAvailability(state, results);

    expect(errors.length).toBe(0);
  });

  test("allows DRILL at any round", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 1;

    const results = [{ nodeId: "R1.A", state: NodeState.DRILL }];
    const errors = Validator.validateStateAvailability(state, results);

    expect(errors.length).toBe(0);
  });

  test("allows VERIFY at any round", () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 1;

    const results = [{ nodeId: "R1.A", state: NodeState.VERIFY }];
    const errors = Validator.validateStateAvailability(state, results);

    expect(errors.length).toBe(0);
  });
});
