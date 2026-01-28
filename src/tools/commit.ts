import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { DotGenerator } from "../state/dot-generator";
import { Validator } from "../state/validation";
import { NodeState, getRequiredChildren, isTerminalState, type ValidationError } from "../types";

const MIN_RESEARCH_TIME_MS = 10000; // 10 seconds minimum

export const commitInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  results: z
    .array(
      z.object({
        nodeId: z.string().describe("The node ID that was executed"),
        state: z.nativeEnum(NodeState).describe("EXPLORE=dig deeper, FOUND=provisional (R3+, needs VERIFY), VERIFY=confirms FOUND, DEAD=dead end"),
        findings: z.string().describe("What the agent discovered"),
        agentId: z.string().optional().describe("The Task agent ID that performed the research"),
      }),
    )
    .describe("Results from executed agents"),
});

export type CommitInput = z.infer<typeof commitInputSchema>;

export interface CommitResult {
  status: "OK" | "REJECTED";
  errors: ValidationError[];
  warnings: string[];
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
      warnings: [],
      currentRound: 0,
      canEnd: false,
      pendingExplore: [],
      message: "Session not found",
    };
  }

  const warnings: string[] = [];

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
      warnings: [],
      currentRound: state.data.currentRound,
      canEnd: false,
      pendingExplore: [],
      message: `Commit rejected: ${errors.length} error(s)`,
    };
  }

  // Anti-gaming checks: timing and agentId
  for (const result of input.results) {
    const proposal = state.getPendingProposal(result.nodeId);
    if (proposal) {
      const elapsed = Date.now() - proposal.proposedAt;
      if (elapsed < MIN_RESEARCH_TIME_MS) {
        warnings.push(`SUSPICIOUS: ${result.nodeId} committed ${Math.round(elapsed / 1000)}s after propose (min ${MIN_RESEARCH_TIME_MS / 1000}s). Was an agent actually spawned?`);
      }
    }
    if (!result.agentId) {
      warnings.push(`MISSING_AGENT: ${result.nodeId} has no agentId. Cannot verify research was performed.`);
    }
  }

  // Depth enforcement: FOUND only allowed at Round 4+
  const MIN_DEPTH_FOR_FOUND = 4;
  const processedResults = input.results.map((result) => {
    const roundMatch = result.nodeId.match(/^R(\d+)\./);
    const round = roundMatch ? parseInt(roundMatch[1], 10) : 1;

    if (result.state === NodeState.FOUND && round < MIN_DEPTH_FOR_FOUND) {
      warnings.push(`DEPTH_ENFORCED: ${result.nodeId} converted FOUND→EXPLORE (round ${round} < ${MIN_DEPTH_FOR_FOUND}). Add 2 children.`);
      return { ...result, state: NodeState.EXPLORE };
    }
    return result;
  });

  // Add nodes to state using proposal data
  for (const result of processedResults) {
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
    warnings,
    currentRound: state.data.currentRound,
    canEnd: canEndResult.canEnd,
    pendingExplore,
    message: canEndResult.canEnd ? "Ready to end. Call tot_end." : `Continue: ${pendingExplore.length} EXPLORE nodes need children.`,
  };
}
