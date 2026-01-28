import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { DotGenerator } from "../state/dot-generator";
import { NodeState, getRequiredChildren, isTerminalState, type ValidationError } from "../types";

export const commitInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  results: z
    .array(
      z.object({
        nodeId: z.string().describe("The node ID that was executed"),
        state: z.nativeEnum(NodeState).describe("The resulting state"),
        findings: z.string().describe("What the agent discovered"),
        evidence: z.string().optional().describe("Detailed evidence supporting terminal states (min 50 chars for terminal states)"),
        verificationMethod: z.string().optional().describe("How the conclusion was verified"),
        alternativesConsidered: z.array(z.string()).optional().describe("Alternative approaches that were considered"),
      })
    )
    .describe("Results from executed agents"),
});

export type CommitInput = z.infer<typeof commitInputSchema>;

export interface CommitResult {
  status: "OK" | "REJECTED";
  errors: ValidationError[];
  dot: string;
  currentRound: number;
  batchComplete: boolean;
  roundComplete: boolean;
  nextRoundInfo: {
    round: number;
    nodesRequired: number;
    totalBatches: number;
    parentBreakdown: Array<{ parentId: string; state: string; childrenNeeded: number }>;
  };
  message: string;
}

export async function handleCommit(
  input: CommitInput,
  persistDir: string = "./investigations"
): Promise<CommitResult> {
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
      dot: "",
      currentRound: 0,
      batchComplete: false,
      roundComplete: false,
      nextRoundInfo: { round: 0, nodesRequired: 0, totalBatches: 0, parentBreakdown: [] },
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

  // Validate evidence for terminal states (min 50 chars)
  const MIN_EVIDENCE_LENGTH = 50;
  for (const result of input.results) {
    if (isTerminalState(result.state)) {
      if (!result.evidence || result.evidence.length < MIN_EVIDENCE_LENGTH) {
        errors.push({
          nodeId: result.nodeId,
          error: "MISSING_EVIDENCE",
          message: `Terminal state ${result.state} requires evidence (min ${MIN_EVIDENCE_LENGTH} chars)`,
          suggestion: "Provide detailed evidence explaining why this conclusion was reached",
        });
      }
    }
  }

  if (errors.length > 0) {
    return {
      status: "REJECTED",
      errors,
      dot: "",
      currentRound: state.data.currentRound,
      batchComplete: false,
      roundComplete: false,
      nextRoundInfo: { round: 0, nodesRequired: 0, totalBatches: 0, parentBreakdown: [] },
      message: `Commit rejected: ${errors.length} node(s) were not proposed`,
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

  // Calculate next round requirements
  const currentRoundNodes = state.getNodesByRound(state.data.currentRound);
  const parentBreakdown: Array<{ parentId: string; state: string; childrenNeeded: number }> = [];
  let nodesRequired = 0;

  for (const node of currentRoundNodes) {
    if (!isTerminalState(node.state)) {
      const needed = getRequiredChildren(node.state);
      const existing = node.children.length;
      const remaining = Math.max(0, needed - existing);

      if (remaining > 0) {
        parentBreakdown.push({
          parentId: node.id,
          state: node.state,
          childrenNeeded: remaining,
        });
        nodesRequired += remaining;
      }
    }
  }

  // Check if current round is complete
  const roundComplete = nodesRequired === 0 || parentBreakdown.length === 0;

  // Update state
  state.data.currentBatch += 1;
  if (roundComplete && currentRoundNodes.length > 0) {
    state.data.currentRound += 1;
    state.data.currentBatch = 0;
  }

  state.save();

  const dot = DotGenerator.generate(state);
  const MAX_BATCH_SIZE = 5;
  const totalBatches = Math.ceil(nodesRequired / MAX_BATCH_SIZE);

  return {
    status: "OK",
    errors,
    dot,
    currentRound: state.data.currentRound,
    batchComplete: true,
    roundComplete,
    nextRoundInfo: {
      round: state.data.currentRound,
      nodesRequired,
      totalBatches,
      parentBreakdown,
    },
    message: roundComplete
      ? `Round ${state.data.currentRound - 1} complete. Next round requires ${nodesRequired} nodes in ${totalBatches} batch(es).`
      : `Batch complete. ${nodesRequired} nodes still needed for round ${state.data.currentRound}.`,
  };
}
