import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator, getIncompleteExploreNodes } from "../state/validation";
import { NodeState, type ValidationError } from "../types";
import { verifyAgent } from "../utils/agent-verifier";

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

  // Anti-gaming checks: timing, agentId presence, and agent verification
  for (const result of input.results) {
    const proposal = state.getPendingProposal(result.nodeId);
    if (proposal) {
      const elapsed = Date.now() - proposal.proposedAt;
      if (elapsed < MIN_RESEARCH_TIME_MS) {
        warnings.push(`⚠️ WARNING [SUSPICIOUS]: ${result.nodeId} committed ${Math.round(elapsed / 1000)}s after propose (min ${MIN_RESEARCH_TIME_MS / 1000}s). This looks like gaming.`);
      }
    }
    if (!result.agentId) {
      errors.push({
        nodeId: result.nodeId,
        error: "MISSING_AGENT",
        message: `🚨 MISSING_AGENT: ${result.nodeId} has no agentId. You MUST spawn a Task agent.`,
        suggestion: "Spawn a Task agent and use its agentId in the commit",
      });
    } else {
      // Check for agentId reuse within this session
      const previousNode = state.data.usedAgentIds[result.agentId];
      if (previousNode && previousNode !== result.nodeId) {
        errors.push({
          nodeId: result.nodeId,
          error: "REUSED_AGENT",
          message: `🚨 REUSED_AGENT: agentId ${result.agentId} was already used for node ${previousNode}. Each node requires a NEW Task agent.`,
          suggestion: "Spawn a fresh Task agent for each node - do not reuse agentIds",
        });
      } else if (state.data.projectDir) {
        // Verify agent exists in Claude Code session files
        const verification = verifyAgent(result.agentId, state.data.projectDir);
        if (!verification.valid) {
          errors.push({
            nodeId: result.nodeId,
            error: "FAKE_AGENT",
            message: `🚨 FAKE_AGENT: ${verification.reason}`,
            suggestion: "Spawn a real Task agent and use its agentId",
          });
        } else if (verification.reason) {
          // Valid but with a warning (e.g., couldn't find sessions to verify)
          warnings.push(`⚠️ WARNING [UNVERIFIED_AGENT]: ${result.nodeId} - ${verification.reason}`);
        }
      }
    }
  }

  // If any FAKE_AGENT, REUSED_AGENT, or MISSING_AGENT errors, reject the commit
  if (errors.some((e) => e.error === "FAKE_AGENT" || e.error === "REUSED_AGENT" || e.error === "MISSING_AGENT")) {
    return {
      message: "🚫 REJECTED: Agent validation failed. Each node requires a fresh, real Task agent.",
      status: "REJECTED",
      errors,
      warnings,
      currentRound: state.data.currentRound,
      canEnd: false,
      pendingExplore: [],
    };
  }

  // Track used agentIds to prevent reuse
  for (const result of input.results) {
    if (result.agentId) {
      state.data.usedAgentIds[result.agentId] = result.nodeId;
    }
  }

  // Depth enforcement constants
  const MIN_ROUND_FOR_FOUND = 4;
  const MIN_ROUND_FOR_EXHAUST = 3;
  const MIN_ROUND_FOR_DEAD = 4;

  // Depth enforcement: state conversions based on round
  const processedResults = input.results.map((result) => {
    const round = extractRound(result.nodeId);

    // FOUND only allowed at R4+
    if (result.state === NodeState.FOUND && round < MIN_ROUND_FOR_FOUND) {
      warnings.push(`⚠️ WARNING [DEPTH_ENFORCED]: ${result.nodeId} converted FOUND→EXPLORE (round ${round} < ${MIN_ROUND_FOR_FOUND}). You MUST add 2+ children.`);
      return { ...result, state: NodeState.EXPLORE };
    }

    // EXHAUST only allowed at R3+
    if (result.state === NodeState.EXHAUST && round < MIN_ROUND_FOR_EXHAUST) {
      warnings.push(`⚠️ WARNING [EXHAUST_ENFORCED]: ${result.nodeId} converted EXHAUST→EXPLORE (round ${round} < ${MIN_ROUND_FOR_EXHAUST}). You MUST add 2+ children.`);
      return { ...result, state: NodeState.EXPLORE };
    }

    // DEAD only allowed at R4+
    if (result.state === NodeState.DEAD && round < MIN_ROUND_FOR_DEAD) {
      if (round < MIN_ROUND_FOR_EXHAUST) {
        // R1-R2: Convert to EXPLORE
        warnings.push(`⚠️ WARNING [DEAD_ENFORCED]: ${result.nodeId} converted DEAD→EXPLORE (round ${round} < ${MIN_ROUND_FOR_EXHAUST}). You MUST add 2+ children.`);
        return { ...result, state: NodeState.EXPLORE };
      } else {
        // R3: Convert to EXHAUST
        warnings.push(`⚠️ WARNING [DEAD_ENFORCED]: ${result.nodeId} converted DEAD→EXHAUST (round ${round} < ${MIN_ROUND_FOR_DEAD}). You MUST add 1+ DEAD child.`);
        return { ...result, state: NodeState.EXHAUST };
      }
    }

    return result;
  });

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

  state.save();

  // Get incomplete nodes (EXPLORE, FOUND, EXHAUST that need more children)
  const incompleteExplore = getIncompleteExploreNodes(state);
  const pendingExplore = incompleteExplore.map(inc => inc.nodeId);

  // Add INCOMPLETE_EXPLORE warnings for nodes that need more children
  for (const inc of incompleteExplore) {
    warnings.push(`🚨 CRITICAL [INCOMPLETE_EXPLORE]: Node ${inc.nodeId} has ${inc.has} children but REQUIRES ${inc.needs}. You MUST propose more children for this node before calling tot_end.`);
  }

  const canEndResult = Validator.canEndInvestigation(state);

  return {
    message: canEndResult.canEnd ? "Ready to end. Call tot_end." : `CONTINUE REQUIRED: ${pendingExplore.length} EXPLORE nodes need children. Do NOT present results yet.`,
    status: "OK",
    warnings,
    currentRound: state.data.currentRound,
    canEnd: canEndResult.canEnd,
    pendingExplore,
    errors: [],
  };
}
