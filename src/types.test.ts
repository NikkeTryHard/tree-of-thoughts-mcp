import { describe, expect, test } from "bun:test";
import { NodeState, isTerminalState, getRequiredChildren, isPendingState, type ToTNode } from "./types";

describe("NodeState", () => {
  test("terminal states are correctly identified", () => {
    expect(isTerminalState(NodeState.DEAD)).toBe(true);
    expect(isTerminalState(NodeState.VALID)).toBe(true);
    expect(isTerminalState(NodeState.SPEC)).toBe(true);
    expect(isTerminalState(NodeState.DRILL)).toBe(false);
    expect(isTerminalState(NodeState.VERIFY)).toBe(false);
  });

  test("required children count is correct", () => {
    expect(getRequiredChildren(NodeState.DRILL)).toBe(3);
    expect(getRequiredChildren(NodeState.VERIFY)).toBe(1);
    expect(getRequiredChildren(NodeState.DEAD)).toBe(0);
    expect(getRequiredChildren(NodeState.VALID)).toBe(0);
    expect(getRequiredChildren(NodeState.SPEC)).toBe(0);
  });

  // Task 1.1: VALID_PENDING state tests
  test("VALID_PENDING is not terminal", () => {
    expect(isTerminalState(NodeState.VALID_PENDING)).toBe(false);
  });

  test("VALID_PENDING requires 1 confirmation child", () => {
    expect(getRequiredChildren(NodeState.VALID_PENDING)).toBe(1);
  });

  test("isPendingState identifies pending states", () => {
    expect(isPendingState(NodeState.VALID_PENDING)).toBe(true);
    expect(isPendingState(NodeState.VALID)).toBe(false);
    expect(isPendingState(NodeState.DRILL)).toBe(false);
  });

  test("DRILL requires 3 children", () => {
    expect(getRequiredChildren(NodeState.DRILL)).toBe(3);
  });

  // Task 1.2: Evidence fields tests
  test("ToTNode accepts evidence fields", () => {
    const node: ToTNode = {
      id: "R1.A",
      parent: null,
      state: NodeState.VALID,
      title: "Test",
      findings: "Found",
      children: [],
      round: 1,
      evidence: "Detailed evidence",
      verificationMethod: "Testing",
      alternativesConsidered: ["B", "C"],
    };
    expect(node.evidence).toBe("Detailed evidence");
    expect(node.verificationMethod).toBe("Testing");
    expect(node.alternativesConsidered).toEqual(["B", "C"]);
  });
});
