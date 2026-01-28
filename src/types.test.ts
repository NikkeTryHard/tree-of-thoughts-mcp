import { describe, expect, test } from "bun:test";
import { NodeState, isTerminalState, getRequiredChildren } from "./types";

describe("NodeState", () => {
  test("terminal states are correctly identified", () => {
    expect(isTerminalState(NodeState.DEAD)).toBe(true);
    expect(isTerminalState(NodeState.VALID)).toBe(true);
    expect(isTerminalState(NodeState.SPEC)).toBe(true);
    expect(isTerminalState(NodeState.DRILL)).toBe(false);
    expect(isTerminalState(NodeState.VERIFY)).toBe(false);
  });

  test("required children count is correct", () => {
    expect(getRequiredChildren(NodeState.DRILL)).toBe(2);
    expect(getRequiredChildren(NodeState.VERIFY)).toBe(1);
    expect(getRequiredChildren(NodeState.DEAD)).toBe(0);
    expect(getRequiredChildren(NodeState.VALID)).toBe(0);
    expect(getRequiredChildren(NodeState.SPEC)).toBe(0);
  });
});
