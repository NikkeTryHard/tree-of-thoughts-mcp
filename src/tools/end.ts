import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator } from "../state/validation";
import { DotGenerator } from "../state/dot-generator";
import { NodeState } from "../types";

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
    };
  }

  const canEndResult = Validator.canEndInvestigation(state);

  if (!canEndResult.canEnd) {
    return {
      status: "REJECTED",
      reason: canEndResult.reason,
      sessionId: state.data.sessionId,
      query: state.data.query,
      totalRounds: state.data.currentRound,
      totalNodes: state.getAllNodes().length,
      finalDot: DotGenerator.generate(state),
      solutions: [],
      deadEnds: 0,
    };
  }

  const allNodes = state.getAllNodes();

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
    status: "OK",
    sessionId: state.data.sessionId,
    query: state.data.query,
    totalRounds: state.data.currentRound,
    totalNodes: allNodes.length,
    finalDot: DotGenerator.generate(state),
    solutions,
    deadEnds,
  };
}
