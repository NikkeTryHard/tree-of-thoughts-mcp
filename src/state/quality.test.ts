import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { QualityCalculator } from "./quality";
import { InvestigationState } from "./investigation";
import { NodeState } from "../types";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("QualityCalculator", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  test("calculates depth score", () => {
    const state = InvestigationState.create("Test", 1, TEST_DIR);

    // Build tree with max depth 4
    state.addNode({ id: "R1.A", parent: null, state: NodeState.DRILL, title: "A", findings: null, children: [], round: 1 });
    state.addNode({ id: "R2.A1", parent: "R1.A", state: NodeState.DRILL, title: "A1", findings: null, children: [], round: 2 });
    state.addNode({ id: "R3.A1a", parent: "R2.A1", state: NodeState.DRILL, title: "A1a", findings: null, children: [], round: 3 });
    state.addNode({ id: "R4.A1a1", parent: "R3.A1a", state: NodeState.VALID, title: "A1a1", findings: "Done", children: [], round: 4 });

    const quality = QualityCalculator.calculate(state);

    expect(quality.maxDepth).toBe(4);
    expect(quality.depthScore).toBeCloseTo(0.8, 1); // 4/5 = 0.8
  });

  test("calculates breadth score", () => {
    const state = InvestigationState.create("Test", 1, TEST_DIR);

    // Root with 3 children
    state.addNode({ id: "R1.A", parent: null, state: NodeState.DRILL, title: "A", findings: null, children: [], round: 1 });
    state.addNode({ id: "R2.A1", parent: "R1.A", state: NodeState.DEAD, title: "A1", findings: "Dead", children: [], round: 2 });
    state.addNode({ id: "R2.A2", parent: "R1.A", state: NodeState.DEAD, title: "A2", findings: "Dead", children: [], round: 2 });
    state.addNode({ id: "R2.A3", parent: "R1.A", state: NodeState.VALID, title: "A3", findings: "Done", children: [], round: 2 });

    const quality = QualityCalculator.calculate(state);

    expect(quality.avgBranchingFactor).toBeCloseTo(3, 0); // 3 children / 1 parent
    expect(quality.breadthScore).toBeCloseTo(1.0, 1); // 3/3 = 1.0 (capped at 1)
  });

  test("calculates balance score", () => {
    const state = InvestigationState.create("Test", 1, TEST_DIR);

    state.addNode({ id: "R1.A", parent: null, state: NodeState.DEAD, title: "A", findings: "Dead", children: [], round: 1 });
    state.addNode({ id: "R1.B", parent: null, state: NodeState.DEAD, title: "B", findings: "Dead", children: [], round: 1 });
    state.addNode({ id: "R1.C", parent: null, state: NodeState.VALID, title: "C", findings: "Valid", children: [], round: 1 });

    const quality = QualityCalculator.calculate(state);

    // 2 DEAD, 1 VALID -> ratio = 2/3 = 0.67
    expect(quality.balanceScore).toBeCloseTo(0.67, 1);
  });

  test("calculates composite quality score", () => {
    const state = InvestigationState.create("Test", 1, TEST_DIR);

    // Build reasonable investigation
    state.addNode({ id: "R1.A", parent: null, state: NodeState.DRILL, title: "A", findings: null, children: [], round: 1 });
    state.addNode({ id: "R2.A1", parent: "R1.A", state: NodeState.DRILL, title: "A1", findings: null, children: [], round: 2 });
    state.addNode({ id: "R2.A2", parent: "R1.A", state: NodeState.DEAD, title: "A2", findings: "Dead", children: [], round: 2 });
    state.addNode({ id: "R2.A3", parent: "R1.A", state: NodeState.DEAD, title: "A3", findings: "Dead", children: [], round: 2 });
    state.addNode({ id: "R3.A1a", parent: "R2.A1", state: NodeState.DRILL, title: "A1a", findings: null, children: [], round: 3 });
    state.addNode({ id: "R3.A1b", parent: "R2.A1", state: NodeState.DEAD, title: "A1b", findings: "Dead", children: [], round: 3 });
    state.addNode({ id: "R3.A1c", parent: "R2.A1", state: NodeState.DEAD, title: "A1c", findings: "Dead", children: [], round: 3 });
    state.addNode({ id: "R4.A1a1", parent: "R3.A1a", state: NodeState.VALID, title: "A1a1", findings: "Done", children: [], round: 4 });
    state.addNode({ id: "R4.A1a2", parent: "R3.A1a", state: NodeState.DEAD, title: "A1a2", findings: "Dead", children: [], round: 4 });
    state.addNode({ id: "R4.A1a3", parent: "R3.A1a", state: NodeState.DEAD, title: "A1a3", findings: "Dead", children: [], round: 4 });

    const quality = QualityCalculator.calculate(state);

    expect(quality.compositeScore).toBeGreaterThan(0.5);
  });

  test("returns zero metrics for empty investigation", () => {
    const state = InvestigationState.create("Test", 1, TEST_DIR);

    const quality = QualityCalculator.calculate(state);

    expect(quality.maxDepth).toBe(0);
    expect(quality.compositeScore).toBe(0);
  });
});
