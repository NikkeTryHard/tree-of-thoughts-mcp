import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator, getIncompleteNonTerminalNodes, formatIncompleteSummary, type IncompleteNode } from "../state/validation";
import { NodeState, type ValidationError, getValidChildStates } from "../types";

const MIN_RESEARCH_TIME_MS = 10000; // 10 seconds minimum

/**
 * Extract round number from node ID (e.g., "R3.A1" -> 3)
 */
function extractRound(nodeId: string, defaultRound: number = 1): number {
  const match = nodeId.match(/^R(\d+)\./);
  return match ? parseInt(match[1], 10) : defaultRound;
}

export const commitInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  results: z
    .array(
      z.object({
        nodeId: z.string().describe("The node ID that was executed"),
        state: z.nativeEnum(NodeState).describe("EXPLORE=dig deeper, FOUND=provisional (R4+, needs VERIFY), VERIFY=confirms FOUND, DEAD=dead end"),
        findings: z.string().describe("What the agent discovered"),
        agentId: z.string().optional().describe("Optional agent identifier for traceability only; it is not verified or required"),
      }),
    )
    .describe("Results from executed agents"),
  minRounds: z.number().int().min(1).max(20).optional().describe("Optional minimum round override for canEnd. Use 2 or 3 for smoke tests; default is 5."),
  allowEarlyTerminal: z.boolean().optional().describe("Allow FOUND/DEAD/EXHAUST before R4. Defaults true when minRounds is less than 4."),
  suppressTimingWarnings: z.boolean().optional().describe("Suppress fast-commit warning for intentional auto-propose/commit paths."),
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
  canEndReason?: string;
  pendingNonTerminal: IncompleteNode[];
  pendingChildren: number;
  minRounds: number;
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
      pendingNonTerminal: [],
      pendingChildren: 0,
      canEndReason: "Session not found",
      minRounds: 5,
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
      pendingNonTerminal: [],
      pendingChildren: 0,
      canEndReason: `Commit rejected: ${errors.length} error(s)`,
      minRounds: input.minRounds ?? 5,
      message: `Commit rejected: ${errors.length} error(s)`,
    };
  }

  // Timing is a soft nudge only. Agent ID verification is intentionally disabled:
  // current harnesses expose different agent identifiers, and ToT should not block valid work on stale Claude-only session-file checks.
  for (const result of input.results) {
    const proposal = state.getPendingProposal(result.nodeId);
    if (proposal) {
      const elapsed = Date.now() - proposal.proposedAt;
      if (!input.suppressTimingWarnings && elapsed < MIN_RESEARCH_TIME_MS) {
        warnings.push(`[WARNING:SUSPICIOUS] ${result.nodeId} committed ${Math.round(elapsed / 1000)}s after propose (min ${MIN_RESEARCH_TIME_MS / 1000}s). This may mean the node was not independently researched.`);
      }
    }
  }

  const minRounds = input.minRounds ?? state.data.minRounds ?? 5;
  const allowEarlyTerminal = input.allowEarlyTerminal ?? state.data.allowEarlyTerminal ?? minRounds < 4;
  // Depth enforcement constants
  const R3_EXPLORE_ONLY = 3;
  const MIN_ROUND_FOR_FOUND = 4;
  const MIN_ROUND_FOR_EXHAUST = 4;  // Changed from 3
  const MIN_ROUND_FOR_DEAD = 4;

  // Depth enforcement: state conversions based on round
  const processedResults = input.results.map((result) => {
    const round = extractRound(result.nodeId);

    // R3 EXPLORE-only rule first
    if (!allowEarlyTerminal && round === R3_EXPLORE_ONLY && result.state !== NodeState.EXPLORE) {
      warnings.push(`[WARNING:R3_EXPLORE_ONLY] ${result.nodeId} converted ${result.state}->EXPLORE (R3 must be EXPLORE only).`);
      return { ...result, state: NodeState.EXPLORE };
    }

    // FOUND only allowed at R4+
    if (!allowEarlyTerminal && result.state === NodeState.FOUND && round < MIN_ROUND_FOR_FOUND) {
      warnings.push(`[WARNING:DEPTH_ENFORCED] ${result.nodeId} converted FOUND->EXPLORE (round ${round} < ${MIN_ROUND_FOR_FOUND}). You MUST add 2+ children.`);
      return { ...result, state: NodeState.EXPLORE };
    }

    // EXHAUST only allowed at R4+
    if (!allowEarlyTerminal && result.state === NodeState.EXHAUST && round < MIN_ROUND_FOR_EXHAUST) {
      warnings.push(`[WARNING:EXHAUST_ENFORCED] ${result.nodeId} converted EXHAUST->EXPLORE (round ${round} < ${MIN_ROUND_FOR_EXHAUST}). You MUST add 2+ children.`);
      return { ...result, state: NodeState.EXPLORE };
    }

    // DEAD only allowed at R4+
    if (!allowEarlyTerminal && result.state === NodeState.DEAD && round < MIN_ROUND_FOR_DEAD) {
      warnings.push(`[WARNING:DEAD_ENFORCED] ${result.nodeId} converted DEAD->EXPLORE (round ${round} < ${MIN_ROUND_FOR_DEAD}). You MUST add 2+ children.`);
      return { ...result, state: NodeState.EXPLORE };
    }

    return result;
  });

  // Validate child states against parent valid children
  for (const result of processedResults) {
    const proposal = state.getPendingProposal(result.nodeId);
    if (proposal && proposal.parent) {
      const parent = state.getNode(proposal.parent);
      if (parent) {
        const validChildren = getValidChildStates(parent.state);
        if (!validChildren.includes(result.state)) {
          errors.push({
            nodeId: result.nodeId,
            error: "INVALID_CHILD_STATE",
            message: `${result.state} is not a valid child of ${parent.state} node ${proposal.parent}`,
            suggestion: `Valid children for ${parent.state}: ${validChildren.join(", ")}`,
          });
        }
      }
    }
  }

  // If any INVALID_CHILD_STATE errors, reject
  if (errors.some(e => e.error === "INVALID_CHILD_STATE")) {
    return {
      message: "REJECTED: Invalid child state transitions detected.",
      status: "REJECTED",
      errors,
      warnings,
      currentRound: state.data.currentRound,
      canEnd: false,
      pendingExplore: [],
      pendingNonTerminal: [],
      pendingChildren: 0,
      canEndReason: "Invalid child state transitions detected",
      minRounds: input.minRounds ?? 5,
    };
  }

  // Add nodes to state using proposal data
  for (const result of processedResults) {
    const proposal = state.getPendingProposal(result.nodeId)!;
    const round = extractRound(result.nodeId, state.data.currentRound);

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

  // Update round tracking
  const allNodes = state.getAllNodes();
  const maxRound = Math.max(...allNodes.map((n) => n.round), 1);
  state.data.currentRound = maxRound;
  state.data.currentBatch += 1;

  state.data.minRounds = minRounds;
  state.data.allowEarlyTerminal = allowEarlyTerminal;
  state.save();

  // Get incomplete nodes (EXPLORE, FOUND, EXHAUST that need more children)
  const relaxExploreChildren = minRounds < 4;
  const pendingNonTerminal = getIncompleteNonTerminalNodes(state, false).filter((node) => !(relaxExploreChildren && node.state === NodeState.EXPLORE));
  const pendingChildren = pendingNonTerminal.reduce((sum, node) => sum + Math.max(0, node.needs - node.has), 0);
  const pendingExplore = minRounds < 4 ? [] : pendingNonTerminal.filter((node) => node.state === NodeState.EXPLORE).map((node) => node.nodeId);

  for (const node of pendingNonTerminal) {
    warnings.push(`[CRITICAL:INCOMPLETE_${node.state}] Node ${node.nodeId} is ${node.state} and has ${node.has} children but requires ${node.needs} ${node.childLabel}. You MUST propose ${node.childLabel} before calling tot_end.`);
  }

  const canEndResult = Validator.canEndInvestigation(state, minRounds, relaxExploreChildren);
  const pendingSummary = formatIncompleteSummary(pendingNonTerminal);
  const reason = pendingSummary || canEndResult.reason || "more investigation needed";
  const continueMessage = `CONTINUE REQUIRED: ${reason.replace(/[.\s]+$/, "")}. Do NOT present results yet.`;

  return {
    message: canEndResult.canEnd ? "Ready to end. Call tot_end." : continueMessage,
    status: "OK",
    warnings,
    currentRound: state.data.currentRound,
    canEnd: canEndResult.canEnd,
    canEndReason: canEndResult.reason,
    pendingNonTerminal,
    pendingChildren,
    minRounds,
    pendingExplore,
    errors: [],
  };
}
