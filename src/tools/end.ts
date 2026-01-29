import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator } from "../state/validation";
import { DotGenerator } from "../state/dot-generator";
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
});

export type EndInput = z.infer<typeof endInputSchema>;

export interface NodeSummary {
  nodeId: string;
  title: string;
  findings: string;
  round: number;
}

export interface EndResult {
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
}

export async function handleEnd(input: EndInput, persistDir: string = "./investigations"): Promise<EndResult> {
  const state = InvestigationState.load(input.sessionId, persistDir);

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
    };
  }

  const canEndResult = Validator.canEndInvestigation(state);

  if (!canEndResult.canEnd) {
    return {
      message: `🚫 REJECTED: Cannot end investigation. ${canEndResult.reason}. Fix this before calling tot_end again.`,
      status: "REJECTED",
      reason: canEndResult.reason,
      sessionId: state.data.sessionId,
      query: state.data.query,
      totalRounds: state.data.currentRound,
      totalNodes: state.getAllNodes().length,
      finalDot: DotGenerator.generate(state),
      solutions: [],
      deadEnds: 0,
      references: [],
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
    message: `Investigation complete. ${solutions.length} solutions found, ${deadEnds} dead ends.`,
    status: "OK",
    sessionId: state.data.sessionId,
    query: state.data.query,
    totalRounds: state.data.currentRound,
    totalNodes: allNodes.length,
    solutions,
    deadEnds,
    references,
    finalDot: DotGenerator.generate(state),
  };
}
