import { describe, expect, test } from "bun:test";
import { DotGenerator } from "./dot-generator";
import { InvestigationState } from "./investigation";
import { NodeState } from "../types";

const TEST_DIR = "./test-investigations";

describe("DotGenerator", () => {
  test("generates empty graph for new investigation", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    const dot = DotGenerator.generate(state);
    expect(dot).toContain("digraph Investigation");
    expect(dot).toContain("rankdir=TB");
  });

  test("generates node with correct color", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Test Node",
      findings: null,
      children: [],
      round: 1,
    });
    const dot = DotGenerator.generate(state);
    expect(dot).toContain("R1_A");
    expect(dot).toContain("fillcolor=lightblue");
    expect(dot).toContain("Test Node");
  });

  test("generates edges between parent and child", () => {
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
    state.addNode({
      id: "R2.A1",
      parent: "R1.A",
      state: NodeState.VALID,
      title: "Child",
      findings: null,
      children: [],
      round: 2,
    });
    const dot = DotGenerator.generate(state);
    expect(dot).toContain("R1_A -> R2_A1");
  });

  test("includes legend", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    const dot = DotGenerator.generate(state);
    expect(dot).toContain("cluster_legend");
    expect(dot).toContain("DRILL");
    expect(dot).toContain("VERIFY");
    expect(dot).toContain("DEAD");
    expect(dot).toContain("VALID");
    expect(dot).toContain("SPEC");
  });

  test("escapes special characters in labels", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: 'Test "quotes" and <brackets>',
      findings: null,
      children: [],
      round: 1,
    });
    const dot = DotGenerator.generate(state);
    expect(dot).not.toContain('""');
    expect(dot).toContain("quotes");
  });
});
