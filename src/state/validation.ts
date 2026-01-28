import { NodeState, isTerminalState, isPendingState, getRequiredChildren, type ValidationError, type ProposedNode } from "../types";
import type { InvestigationState } from "./investigation";
import { QualityCalculator } from "./quality";

export class Validator {
  static validateProposedNode(
    proposed: ProposedNode,
    state: InvestigationState
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (state.getNode(proposed.id)) {
      errors.push({
        nodeId: proposed.id,
        error: "DUPLICATE_ID",
        message: `Node ${proposed.id} already exists`,
        suggestion: "Use a unique node ID",
      });
    }

    if (proposed.parent !== null) {
      const parent = state.getNode(proposed.parent);
      if (!parent) {
        errors.push({
          nodeId: proposed.id,
          error: "PARENT_NOT_FOUND",
          message: `Parent node ${proposed.parent} does not exist`,
          suggestion: "Ensure parent node is committed before proposing children",
        });
      } else if (isTerminalState(parent.state)) {
        errors.push({
          nodeId: proposed.id,
          error: "TERMINAL_PARENT",
          message: `Parent ${proposed.parent} is ${parent.state} (terminal). Cannot spawn children from terminal nodes.`,
          suggestion: `Reclassify ${proposed.parent} to DRILL or VERIFY first using tot_reclassify`,
        });
      }
    }

    const idPattern = /^R\d+\.[A-Za-z0-9]+$/;
    if (!idPattern.test(proposed.id)) {
      errors.push({
        nodeId: proposed.id,
        error: "INVALID_ID_FORMAT",
        message: `Node ID ${proposed.id} does not match format R[round].[id]`,
        suggestion: "Use format like R1.A, R2.A1, R3.A1a",
      });
    }

    return errors;
  }

  static validateProposedBatch(
    proposed: ProposedNode[],
    state: InvestigationState
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (proposed.length > 5) {
      errors.push({
        nodeId: "BATCH",
        error: "BATCH_OVERFLOW",
        message: `Batch contains ${proposed.length} nodes, maximum is 5`,
        suggestion: "Split into multiple batches of 5 or fewer",
      });
    }

    const ids = proposed.map((p) => p.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    for (const dup of duplicates) {
      errors.push({
        nodeId: dup,
        error: "DUPLICATE_IN_BATCH",
        message: `Node ID ${dup} appears multiple times in batch`,
        suggestion: "Ensure each node has a unique ID",
      });
    }

    for (const node of proposed) {
      errors.push(...this.validateProposedNode(node, state));
    }

    return errors;
  }

  static validateReclassification(
    nodeId: string,
    newState: NodeState,
    state: InvestigationState
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const node = state.getNode(nodeId);

    if (!node) {
      errors.push({
        nodeId,
        error: "NODE_NOT_FOUND",
        message: `Node ${nodeId} does not exist`,
        suggestion: "Check node ID spelling",
      });
      return errors;
    }

    if (isTerminalState(newState) && node.children.length > 0) {
      errors.push({
        nodeId,
        error: "HAS_CHILDREN",
        message: `Cannot reclassify ${nodeId} to ${newState} because it has ${node.children.length} children`,
        suggestion: "Resolve or reclassify children first, or reclassify to DRILL/VERIFY",
      });
    }

    return errors;
  }

  static validateRoundCompletion(
    state: InvestigationState,
    round: number
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const nodesInRound = state.getNodesByRound(round);

    for (const node of nodesInRound) {
      if (!isTerminalState(node.state)) {
        const required = getRequiredChildren(node.state);
        if (node.children.length < required) {
          errors.push({
            nodeId: node.id,
            error: "INSUFFICIENT_CHILDREN",
            message: `${node.state} node ${node.id} has ${node.children.length} children but requires >= ${required}`,
            suggestion: `Add more children to ${node.id} or reclassify it to a terminal state`,
          });
        }
      }
    }

    return errors;
  }

  static canEndInvestigation(state: InvestigationState): {
    canEnd: boolean;
    reason?: string;
    qualityScore?: number;
  } {
    if (state.data.currentRound < 3) {
      const allNodes = state.getAllNodes();
      const allTerminal = allNodes.every((n) => isTerminalState(n.state));

      if (allTerminal && allNodes.length > 0) {
        return {
          canEnd: false,
          reason: `RECOVERY_REQUIRED: All nodes are terminal but only at round ${state.data.currentRound}. Must reach round 3 or spawn new lateral roots.`,
        };
      }

      return {
        canEnd: false,
        reason: `Investigation is at round ${state.data.currentRound}, minimum 3 rounds required`,
      };
    }

    const allNodes = state.getAllNodes();

    // A node is "unresolved" if it's non-terminal AND doesn't have enough children
    const unresolvedNodes = allNodes.filter((n) => {
      if (isTerminalState(n.state)) return false;
      const required = getRequiredChildren(n.state);
      return n.children.length < required;
    });

    if (unresolvedNodes.length > 0) {
      return {
        canEnd: false,
        reason: `${unresolvedNodes.length} nodes still need children: ${unresolvedNodes.map((n) => n.id).join(", ")}`,
      };
    }

    if (state.getPendingProposalCount() > 0) {
      return {
        canEnd: false,
        reason: `${state.getPendingProposalCount()} pending proposals not yet committed`,
      };
    }

    // Quality gate - require minimum composite score
    const quality = QualityCalculator.calculate(state);
    const MIN_QUALITY_SCORE = 0.5;
    const MIN_DEPTH = 4;

    // Minimum depth requirement
    if (quality.maxDepth < MIN_DEPTH) {
      return {
        canEnd: false,
        reason: `Investigation must reach depth ${MIN_DEPTH}. Current max depth: ${quality.maxDepth}`,
        qualityScore: quality.compositeScore,
      };
    }

    if (quality.compositeScore < MIN_QUALITY_SCORE) {
      return {
        canEnd: false,
        reason: `Investigation quality score ${quality.compositeScore.toFixed(2)} is below minimum ${MIN_QUALITY_SCORE}. Depth: ${quality.depthScore.toFixed(2)}, Breadth: ${quality.breadthScore.toFixed(2)}, Balance: ${quality.balanceScore.toFixed(2)}`,
        qualityScore: quality.compositeScore,
      };
    }

    return { canEnd: true, qualityScore: quality.compositeScore };
  }

  static validateMinRoots(
    state: InvestigationState,
    proposedCount: number
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const existingRoots = state.getNodesByRound(1).length;
    const totalRoots = existingRoots + proposedCount;

    if (state.data.currentRound === 1 && totalRoots < state.data.minRoots) {
      errors.push({
        nodeId: "BATCH",
        error: "INSUFFICIENT_ROOTS",
        message: `Round 1 requires at least ${state.data.minRoots} root nodes. Current: ${existingRoots}, Proposed: ${proposedCount}, Total: ${totalRoots}`,
        suggestion: `Add ${state.data.minRoots - totalRoots} more root nodes`,
      });
    }

    return errors;
  }

  static validateTerminalRatio(
    state: InvestigationState,
    results: Array<{ nodeId: string; state: NodeState }>
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // Terminal ratio limits by round
    const TERMINAL_LIMITS: Record<number, number> = {
      1: 0.0,   // 0% terminal in round 1
      2: 0.35,  // 35% terminal in round 2
      3: 0.50,  // 50% terminal in round 3
      4: 1.0,   // 100% terminal allowed in round 4+ (finishing phase)
    };

    // Determine the round from the node IDs (they should all be same round)
    // Node IDs are formatted as R[round].[id], e.g., R1.A, R2.A1
    const extractRound = (nodeId: string): number => {
      const match = nodeId.match(/^R(\d+)\./);
      return match ? parseInt(match[1], 10) : state.data.currentRound;
    };

    // Use the round from the first node, or fall back to current round
    const round = results.length > 0 ? extractRound(results[0].nodeId) : state.data.currentRound;
    const limit = TERMINAL_LIMITS[round] ?? TERMINAL_LIMITS[4];

    const terminalCount = results.filter((r) =>
      isTerminalState(r.state) || isPendingState(r.state)
    ).length;

    const ratio = results.length > 0 ? terminalCount / results.length : 0;

    if (ratio > limit) {
      errors.push({
        nodeId: "BATCH",
        error: "TERMINAL_RATIO_EXCEEDED",
        message: `Round ${round} allows max ${Math.round(limit * 100)}% terminal states. Batch has ${Math.round(ratio * 100)}% (${terminalCount}/${results.length})`,
        suggestion: "Mark more nodes as DRILL or VERIFY to continue exploration",
      });
    }

    return errors;
  }

  static validateStateAvailability(
    state: InvestigationState,
    results: Array<{ nodeId: string; state: NodeState }>
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // States locked until certain rounds
    const STATE_UNLOCK_ROUND: Partial<Record<NodeState, number>> = {
      [NodeState.VALID]: 3,
      [NodeState.VALID_PENDING]: 3,
      [NodeState.SPEC]: 3,
    };

    // Extract round from node ID (format: R[round].[id])
    const extractRound = (nodeId: string): number => {
      const match = nodeId.match(/^R(\d+)\./);
      return match ? parseInt(match[1], 10) : state.data.currentRound;
    };

    for (const result of results) {
      const unlockRound = STATE_UNLOCK_ROUND[result.state];
      const nodeRound = extractRound(result.nodeId);
      if (unlockRound && nodeRound < unlockRound) {
        errors.push({
          nodeId: result.nodeId,
          error: "STATE_LOCKED",
          message: `${result.state} is not available until round ${unlockRound}. Node round: ${nodeRound}`,
          suggestion: "Use DRILL or VERIFY to continue exploration, or DEAD if truly a dead end",
        });
      }
    }

    return errors;
  }
}
