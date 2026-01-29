import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator } from "../state/validation";
import { DotGenerator } from "../state/dot-generator";
import { NodeState, isTerminalState, getRequiredChildren } from "../types";

export const statusInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
});

export type StatusInput = z.infer<typeof statusInputSchema>;

export interface StatusResult {
  status: "OK" | "REJECTED";
  sessionId: string;
  query: string;
  currentRound: number;
  totalNodes: number;
  activeExplore: number;
  terminalNodes: number;
  pendingChildren: number;
  canEnd: boolean;
  endBlocker?: string;
  dot: string;
  nextAction: string;
}

export async function handleStatus(input: StatusInput, persistDir: string = "./investigations"): Promise<StatusResult> {
  const state = InvestigationState.load(input.sessionId, persistDir);

  if (!state) {
    return {
      status: "REJECTED",
      sessionId: input.sessionId,
      query: "",
      currentRound: 0,
      totalNodes: 0,
      activeExplore: 0,
      terminalNodes: 0,
      pendingChildren: 0,
      canEnd: false,
      endBlocker: "Session not found",
      dot: "",
      nextAction: "Call tot_start to create a new investigation",
    };
  }

  const allNodes = state.getAllNodes();
  const exploreNodes = allNodes.filter((n) => n.state === NodeState.EXPLORE);
  const terminalNodes = allNodes.filter((n) => isTerminalState(n.state));

  // Calculate pending children needed
  let pendingChildren = 0;
  for (const node of exploreNodes) {
    const required = getRequiredChildren(node.state);
    const existing = node.children.length;
    pendingChildren += Math.max(0, required - existing);
  }

  const canEndResult = Validator.canEndInvestigation(state);

  let nextAction: string;
  if (pendingChildren > 0) {
    nextAction = `Propose ${pendingChildren} more children for EXPLORE nodes`;
  } else if (!canEndResult.canEnd) {
    nextAction = canEndResult.reason || "Continue investigation";
  } else {
    nextAction = "Call tot_end to finalize";
  }

  return {
    nextAction,
    status: "OK",
    sessionId: state.data.sessionId,
    query: state.data.query,
    currentRound: state.data.currentRound,
    totalNodes: allNodes.length,
    activeExplore: exploreNodes.length,
    terminalNodes: terminalNodes.length,
    pendingChildren,
    canEnd: canEndResult.canEnd,
    endBlocker: canEndResult.reason,
    dot: DotGenerator.generate(state),
  };
}
