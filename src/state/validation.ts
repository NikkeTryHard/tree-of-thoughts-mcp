import { NodeState, isTerminalState, getRequiredChildren, type ValidationError, type ProposedNode } from "../types";
import type { InvestigationState } from "./investigation";

export class Validator {
  static validateProposedNode(proposed: ProposedNode, state: InvestigationState): ValidationError[] {
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
          message: `Parent ${proposed.parent} is ${parent.state} (terminal)`,
          suggestion: `Reclassify ${proposed.parent} to EXPLORE first`,
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

  static validateProposedBatch(proposed: ProposedNode[], state: InvestigationState): ValidationError[] {
    const errors: ValidationError[] = [];

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

  static validateReclassification(nodeId: string, newState: NodeState, state: InvestigationState): ValidationError[] {
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
        suggestion: "Resolve or reclassify children first",
      });
    }

    return errors;
  }

  static canEndInvestigation(state: InvestigationState): {
    canEnd: boolean;
    reason?: string;
  } {
    // Rule 1: Minimum 5 rounds
    if (state.data.currentRound < 5) {
      const allNodes = state.getAllNodes();
      const allTerminal = allNodes.every((n) => isTerminalState(n.state));

      if (allTerminal && allNodes.length > 0) {
        return {
          canEnd: false,
          reason: `RECOVERY_REQUIRED: All nodes terminal at round ${state.data.currentRound}. Spawn new roots (R1.F, R1.G, etc.)`,
        };
      }

      return {
        canEnd: false,
        reason: `Round ${state.data.currentRound} < 5. Continue investigation.`,
      };
    }

    // Rule 2: All EXPLORE nodes must have 2+ children
    const allNodes = state.getAllNodes();
    const unresolvedNodes = allNodes.filter((n) => {
      if (isTerminalState(n.state)) return false;
      const required = getRequiredChildren(n.state);
      return n.children.length < required;
    });

    if (unresolvedNodes.length > 0) {
      return {
        canEnd: false,
        reason: `${unresolvedNodes.length} EXPLORE nodes need children: ${unresolvedNodes.map((n) => n.id).join(", ")}`,
      };
    }

    // Rule 3: No pending proposals
    if (state.getPendingProposalCount() > 0) {
      return {
        canEnd: false,
        reason: `${state.getPendingProposalCount()} pending proposals not committed`,
      };
    }

    return { canEnd: true };
  }
}
