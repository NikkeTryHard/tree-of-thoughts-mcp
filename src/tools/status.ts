import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator } from "../state/validation";
import { DotGenerator } from "../state/dot-generator";
import { QualityCalculator, type QualityMetrics } from "../state/quality";
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
  currentBatch: number;
  totalNodes: number;
  activeDrills: number;
  activeVerifies: number;
  terminalNodes: number;
  nodesInQueue: number;
  canEnd: boolean;
  endBlocker?: string;
  dot: string;
  nextActions: string[];
  quality?: QualityMetrics;
}

export async function handleStatus(
  input: StatusInput,
  persistDir: string = "./investigations"
): Promise<StatusResult> {
  const state = InvestigationState.load(input.sessionId, persistDir);

  if (!state) {
    return {
      status: "REJECTED",
      sessionId: input.sessionId,
      query: "",
      currentRound: 0,
      currentBatch: 0,
      totalNodes: 0,
      activeDrills: 0,
      activeVerifies: 0,
      terminalNodes: 0,
      nodesInQueue: 0,
      canEnd: false,
      endBlocker: "Session not found",
      dot: "",
      nextActions: ["Call tot_start to create a new investigation"],
    };
  }

  const allNodes = state.getAllNodes();
  const drillNodes = allNodes.filter((n) => n.state === NodeState.DRILL);
  const verifyNodes = allNodes.filter((n) => n.state === NodeState.VERIFY);
  const terminalNodes = allNodes.filter((n) => isTerminalState(n.state));

  // Calculate queue
  let nodesInQueue = 0;
  for (const node of [...drillNodes, ...verifyNodes]) {
    const required = getRequiredChildren(node.state);
    const existing = node.children.length;
    nodesInQueue += Math.max(0, required - existing);
  }

  const canEndResult = Validator.canEndInvestigation(state);
  const quality = QualityCalculator.calculate(state);

  const nextActions: string[] = [];
  if (nodesInQueue > 0) {
    nextActions.push(`Call tot_propose to add ${nodesInQueue} child node(s)`);
  } else if (!canEndResult.canEnd) {
    nextActions.push(canEndResult.reason || "Continue investigation");
  } else {
    nextActions.push("Call tot_end to finalize the investigation");
  }

  return {
    status: "OK",
    sessionId: state.data.sessionId,
    query: state.data.query,
    currentRound: state.data.currentRound,
    currentBatch: state.data.currentBatch,
    totalNodes: allNodes.length,
    activeDrills: drillNodes.length,
    activeVerifies: verifyNodes.length,
    terminalNodes: terminalNodes.length,
    nodesInQueue,
    canEnd: canEndResult.canEnd,
    endBlocker: canEndResult.reason,
    dot: DotGenerator.generate(state),
    nextActions,
    quality,
  };
}
