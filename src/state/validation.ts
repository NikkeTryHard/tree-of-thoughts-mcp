import { NodeState, isTerminalState, getRequiredChildren, getValidChildStates, type ValidationError, type ProposedNode } from "../types";
import type { InvestigationState } from "./investigation";

/**
 * Check if EXHAUST nodes have only DEAD children (not just any children)
 */
export function getExhaustNodesWithInvalidChildren(state: InvestigationState): { nodeId: string; invalidChildren: string[] }[] {
  const invalid: { nodeId: string; invalidChildren: string[] }[] = [];
  const allNodes = state.getAllNodes();

  for (const node of allNodes) {
    if (node.state === NodeState.EXHAUST && node.children.length > 0) {
      const invalidChildren: string[] = [];
      for (const childId of node.children) {
        const child = state.getNode(childId);
        if (child && child.state !== NodeState.DEAD) {
          invalidChildren.push(childId);
        }
      }
      if (invalidChildren.length > 0) {
        invalid.push({ nodeId: node.id, invalidChildren });
      }
    }
  }

  return invalid;
}

export function getIncompleteExploreNodes(state: InvestigationState): { nodeId: string; has: number; needs: number }[] {
  const incomplete: { nodeId: string; has: number; needs: number }[] = [];
  const allNodes = state.getAllNodes();

  for (const node of allNodes) {
    // Check all non-terminal states that require children: EXPLORE, FOUND, EXHAUST
    if (!isTerminalState(node.state)) {
      const required = getRequiredChildren(node.state, node.round);
      if (required > 0 && node.children.length < required) {
        incomplete.push({
          nodeId: node.id,
          has: node.children.length,
          needs: required,
        });
      }
    }
  }

  return incomplete;
}

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

  /**
   * Validate that a VERIFY node commitment is valid (parent must be FOUND)
   */
  static validateVerifyParent(nodeId: string, parentId: string | null, state: InvestigationState): ValidationError | null {
    if (parentId === null) {
      return {
        nodeId,
        error: "VERIFY_NO_PARENT",
        message: `VERIFY node ${nodeId} must have a parent`,
        suggestion: "VERIFY nodes confirm FOUND nodes - they cannot be roots",
      };
    }

    const parent = state.getNode(parentId);
    if (parent && parent.state !== NodeState.FOUND) {
      return {
        nodeId,
        error: "VERIFY_INVALID_PARENT",
        message: `VERIFY node ${nodeId} parent ${parentId} is ${parent.state}, must be FOUND`,
        suggestion: "VERIFY nodes can only be children of FOUND nodes",
      };
    }

    return null;
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
    const incompleteExplore = getIncompleteExploreNodes(state);
    if (incompleteExplore.length > 0) {
      const details = incompleteExplore.map(n => `${n.nodeId} (has ${n.has}, needs ${n.needs})`).join(", ");
      return {
        canEnd: false,
        reason: `BLOCKED: ${incompleteExplore.length} EXPLORE nodes need more children: ${details}`,
      };
    }

    // Rule 3: EXHAUST nodes must have only DEAD children
    const invalidExhaust = getExhaustNodesWithInvalidChildren(state);
    if (invalidExhaust.length > 0) {
      const details = invalidExhaust.map(n => `${n.nodeId} has non-DEAD children: ${n.invalidChildren.join(", ")}`).join("; ");
      return {
        canEnd: false,
        reason: `BLOCKED: EXHAUST nodes require DEAD children only: ${details}`,
      };
    }

    // Rule 4: No pending proposals
    if (state.getPendingProposalCount() > 0) {
      return {
        canEnd: false,
        reason: `${state.getPendingProposalCount()} pending proposals not committed`,
      };
    }

    return { canEnd: true };
  }
}
