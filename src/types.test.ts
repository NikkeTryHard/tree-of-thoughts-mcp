import { describe, it, expect } from "bun:test";
import { NodeState, isTerminalState, getRequiredChildren } from "./types";

describe("VERIFY state", () => {
  it("VERIFY is terminal", () => {
    expect(isTerminalState(NodeState.VERIFY)).toBe(true);
  });

  it("VERIFY requires 0 children", () => {
    expect(getRequiredChildren(NodeState.VERIFY)).toBe(0);
  });

  it("FOUND is not terminal", () => {
    expect(isTerminalState(NodeState.FOUND)).toBe(false);
  });

  it("FOUND requires 1 child", () => {
    expect(getRequiredChildren(NodeState.FOUND)).toBe(1);
  });
});

describe("existing states", () => {
  it("EXPLORE is not terminal", () => {
    expect(isTerminalState(NodeState.EXPLORE)).toBe(false);
  });

  it("EXPLORE requires 2 children", () => {
    expect(getRequiredChildren(NodeState.EXPLORE)).toBe(2);
  });

  it("DEAD is terminal", () => {
    expect(isTerminalState(NodeState.DEAD)).toBe(true);
  });

  it("DEAD requires 0 children", () => {
    expect(getRequiredChildren(NodeState.DEAD)).toBe(0);
  });
});
