import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { DotGenerator } from "./dot-generator";
import type { InvestigationState } from "./investigation";

export interface GraphNode {
  id: string;
  parent: string | null;
  state: string;
  title: string;
  round: number;
  children: string[];
  findings: string | null;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface TotGraph {
  sessionId: string;
  query: string;
  currentRound: number;
  totalNodes: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  dot: string;
}

export interface PersistedGraph {
  graph: TotGraph;
  graphPath: string;
  dotPath: string;
}

export function generateGraph(state: InvestigationState): TotGraph {
  const nodes = state.getAllNodes().map((node) => ({
    id: node.id,
    parent: node.parent,
    state: node.state,
    title: node.title,
    round: node.round,
    children: [...node.children],
    findings: node.findings,
  }));

  const edges = nodes.flatMap((node) =>
    node.parent === null ? [] : [{ from: node.parent, to: node.id }],
  );

  return {
    sessionId: state.data.sessionId,
    query: state.data.query,
    currentRound: state.data.currentRound,
    totalNodes: nodes.length,
    nodes,
    edges,
    dot: DotGenerator.generate(state),
  };
}

export function persistGraph(state: InvestigationState, outputDir: string): PersistedGraph {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const graph = generateGraph(state);
  const graphPath = join(outputDir, `${state.data.sessionId}.tot-graph.json`);
  const dotPath = join(outputDir, `${state.data.sessionId}.tot-graph.dot`);

  writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  writeFileSync(dotPath, graph.dot);

  return { graph, graphPath, dotPath };
}
