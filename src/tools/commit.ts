import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { DotGenerator } from "../state/dot-generator";
import { Validator } from "../state/validation";
import { NodeState, getRequiredChildren, isTerminalState, type ValidationError } from "../types";

export const commitInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  results: z
    .array(
      z.object({
        nodeId: z.string().describe("The node ID that was executed"),
        state: z.nativeEnum(NodeState).describe("The resulting state: EXPLORE, DEAD, or FOUND"),
        findings: z.string().describe("What the agent discovered"),
      }),
    )
    .describe("Results from executed agents"),
});

export type CommitInput = z.infer<typeof commitInputSchema>;

export interface CommitResult {
  status: "OK" | "REJECTED";
  errors: ValidationError[];
  currentRound: number;
  canEnd: boolean;
  pendingExplore: string[];
  message: string;
}

export async function handleCommit(input: CommitInput, persistDir: string = "./investigations"): Promise<CommitResult> {
  const state = InvestigationState.load(input.sessionId, persistDir);

  if (!state) {
    return {
      status: "REJECTED",
      errors: [
        {
          nodeId: "SESSION",
          error: "SESSION_NOT_FOUND",
          message: `Investigation ${input.sessionId} not found`,
        },
      ],
      currentRound: 0,
      canEnd: false,
      pendingExplore: [],
      message: "Session not found",
    };
  }

  const errors: ValidationError[] = [];

  // Validate that all committed nodes were proposed
  for (const result of input.results) {
    const proposal = state.getPendingProposal(result.nodeId);
    if (!proposal) {
      errors.push({
        nodeId: result.nodeId,
        error: "NOT_PROPOSED",
        message: `Node ${result.nodeId} was not proposed. Call tot_propose first.`,
        suggestion: "Ensure all nodes are proposed before committing",
      });
    }
  }

  if (errors.length > 0) {
    return {
      status: "REJECTED",
      errors,
      currentRound: state.data.currentRound,
      canEnd: false,
      pendingExplore: [],
      message: `Commit rejected: ${errors.length} error(s)`,
    };
  }

  // Add nodes to state using proposal data
  for (const result of input.results) {
    const proposal = state.getPendingProposal(result.nodeId)!;

    // Extract round from ID
    const roundMatch = result.nodeId.match(/^R(\d+)\./);
    const round = roundMatch ? parseInt(roundMatch[1], 10) : state.data.currentRound;

    state.addNode({
      id: result.nodeId,
      parent: proposal.parent,
      state: result.state,
      title: proposal.title,
      findings: result.findings,
      children: [],
      round,
    });

    // Remove from pending
    state.removePendingProposal(result.nodeId);
  }

  // Find EXPLORE nodes that need children
  const allNodes = state.getAllNodes();
  const pendingExplore: string[] = [];

  for (const node of allNodes) {
    if (!isTerminalState(node.state)) {
      const needed = getRequiredChildren(node.state);
      if (node.children.length < needed) {
        pendingExplore.push(node.id);
      }
    }
  }

  // Update round tracking
  const maxRound = Math.max(...allNodes.map((n) => n.round), 1);
  state.data.currentRound = maxRound;
  state.data.currentBatch += 1;

  state.save();

  const canEndResult = Validator.canEndInvestigation(state);

  return {
    status: "OK",
    errors: [],
    currentRound: state.data.currentRound,
    canEnd: canEndResult.canEnd,
    pendingExplore,
    message: canEndResult.canEnd ? "Ready to end. Call tot_end." : `Continue: ${pendingExplore.length} EXPLORE nodes need children.`,
  };
}
