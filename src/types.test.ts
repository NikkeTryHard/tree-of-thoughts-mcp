import { describe, it, expect } from "bun:test";
import { NodeState, isTerminalState, getRequiredChildren, type ProposedNode, type CommitResult } from "./types";

describe("ProposedNode", () => {
  it("should have proposedAt field", () => {
    const proposal: ProposedNode = {
      id: "R1.A",
      parent: null,
      title: "Test",
      plannedAction: "Test action",
      proposedAt: Date.now(),
    };
    expect(proposal.proposedAt).toBeTypeOf("number");
  });
});

describe("CommitResult", () => {
  it("should have optional agentId field", () => {
    const result: CommitResult = {
      nodeId: "R1.A",
      state: NodeState.EXPLORE,
      findings: "Test findings",
      agentId: "agent-123",
    };
    expect(result.agentId).toBe("agent-123");
  });

  it("should allow missing agentId", () => {
    const result: CommitResult = {
      nodeId: "R1.A",
      state: NodeState.EXPLORE,
      findings: "Test findings",
    };
    expect(result.agentId).toBeUndefined();
  });
});

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
