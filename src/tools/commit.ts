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

  // Add nodes to state
  for (const result of input.results) {
    // Extract round from ID
    const roundMatch = result.nodeId.match(/^R(\d+)\./);
    const round = roundMatch ? parseInt(roundMatch[1], 10) : state.data.currentRound;

    // Determine parent from ID pattern
    let parent: string | null = null;
    if (round > 1) {
      // Extract parent ID from hierarchical naming
      // R2.A1 -> parent is R1.A
      // R3.A1a -> parent is R2.A1
      const idParts = result.nodeId.split(".");
      if (idParts.length === 2) {
        const suffix = idParts[1];
        // Remove last character(s) to get parent suffix
        const parentSuffix = suffix.slice(0, -1);
        if (parentSuffix.length > 0) {
          parent = `R${round - 1}.${parentSuffix}`;
        }
      }
    }

    state.addNode({
      id: result.nodeId,
      parent,
      state: result.state,
      title: result.nodeId, // Will be updated with actual title
      findings: result.findings,
      children: [],
      round,
    });
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
  const totalBatches = Math.ceil(nodesRequired / 5);

  return {
    status: "OK",
    errors,
    dot,
    currentRound: state.data.currentRound,
    batchComplete: true,
    roundComplete,
    nextRoundInfo: {
      round: roundComplete ? state.data.currentRound : state.data.currentRound,
      nodesRequired,
      totalBatches,
      parentBreakdown,
    },
    message: roundComplete
      ? `Round ${state.data.currentRound - 1} complete. Next round requires ${nodesRequired} nodes in ${totalBatches} batch(es).`
      : `Batch complete. ${nodesRequired} nodes still needed for round ${state.data.currentRound}.`,
  };
}
