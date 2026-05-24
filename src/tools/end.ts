import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator } from "../state/validation";
import { persistGraph, type TotGraph } from "../state/graph";
import { NodeState, type ToTNode } from "../types";

function extractReferences(nodes: ToTNode[]): string[] {
  const refs: Set<string> = new Set();
  const urlPattern = /https?:\/\/[^\s\)]+/g;
  const pathPattern = /- ([a-zA-Z0-9_\-\.\/]+\.(ts|js|py|rs|go|md))/g;

  for (const node of nodes) {
    if (!node.findings) continue;

    // Extract URLs
    const urls = node.findings.match(urlPattern);
    if (urls) urls.forEach((u) => refs.add(u));

    // Extract file paths from References section
    const refSection = node.findings.match(/## References\n([\s\S]*?)(?=\n##|$)/gi);
    if (refSection) {
      for (const section of refSection) {
        let match;
        while ((match = pathPattern.exec(section)) !== null) {
          refs.add(match[1]);
        }
      }
    }
  }

  return Array.from(refs);
}

export const endInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  minRounds: z.number().int().min(1).max(20).optional().describe("Optional minimum round override for smoke tests; default is 5."),
});

export type EndInput = z.infer<typeof endInputSchema>;

export interface NodeSummary {
  nodeId: string;
  title: string;
  findings: string;
  round: number;
}

export interface EndResult {
  message?: string;
  status: "OK" | "REJECTED";
  reason?: string;
  sessionId: string;
  query: string;
  totalRounds: number;
  totalNodes: number;
  finalDot: string;
  solutions: NodeSummary[];
  deadEnds: number;
  references: string[];
  graph: TotGraph;
  graphPath: string;
  dotPath: string;
  minRounds: number;
}

export async function handleEnd(input: EndInput, persistDir: string = "./investigations", graphDir: string = persistDir): Promise<EndResult> {
  const state = InvestigationState.load(input.sessionId, persistDir);

  const emptyGraph: TotGraph = {
    sessionId: input.sessionId,
    query: "",
    currentRound: 0,
    totalNodes: 0,
    nodes: [],
    edges: [],
    dot: "",
  };
  if (!state) {
    return {
      status: "REJECTED",
      reason: "Session not found",
      sessionId: input.sessionId,
      query: "",
      totalRounds: 0,
      totalNodes: 0,
      finalDot: "",
      solutions: [],
      deadEnds: 0,
      references: [],
      graph: emptyGraph,
      graphPath: "",
      dotPath: "",
      minRounds: input.minRounds ?? 5,
    };
  }

  const minRounds = input.minRounds ?? state.data.minRounds ?? 5;
  const canEndResult = Validator.canEndInvestigation(state, minRounds);
  const persisted = persistGraph(state, graphDir);

  if (!canEndResult.canEnd) {
    return {
      message: `[REJECTED] Cannot end investigation. ${canEndResult.reason}. Fix this before calling tot_end again.`,
      status: "REJECTED",
      reason: canEndResult.reason,
      sessionId: state.data.sessionId,
      query: state.data.query,
      totalRounds: state.data.currentRound,
      totalNodes: state.getAllNodes().length,
      finalDot: persisted.graph.dot,
      graph: persisted.graph,
      graphPath: persisted.graphPath,
      dotPath: persisted.dotPath,
      solutions: [],
      deadEnds: 0,
      references: [],
      minRounds,
    };
  }

  const allNodes = state.getAllNodes();
  const references = extractReferences(allNodes);

  const solutions: NodeSummary[] = allNodes
    .filter((n) => n.state === NodeState.FOUND)
    .map((n) => ({
      nodeId: n.id,
      title: n.title,
      findings: n.findings || "",
      round: n.round,
    }));

  const deadEnds = allNodes.filter((n) => n.state === NodeState.DEAD).length;

  return {
    message: `Investigation complete. ${solutions.length} solutions found, ${deadEnds} dead ends. Graph saved to ${persisted.graphPath}`,
    status: "OK",
    sessionId: state.data.sessionId,
    query: state.data.query,
    totalRounds: state.data.currentRound,
    totalNodes: allNodes.length,
    solutions,
    deadEnds,
    references,
    finalDot: persisted.graph.dot,
    graph: persisted.graph,
    graphPath: persisted.graphPath,
    dotPath: persisted.dotPath,
    minRounds,
  };
}
