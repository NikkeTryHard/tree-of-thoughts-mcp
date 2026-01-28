import type { InvestigationState } from "./investigation";
import { NodeState, isTerminalState } from "../types";

export interface QualityMetrics {
  maxDepth: number;
  avgDepth: number;
  avgBranchingFactor: number;
  terminalRatio: number;
  validToDeadRatio: number;
  depthScore: number;      // 0-1, based on maxDepth/5
  breadthScore: number;    // 0-1, based on avgBranchingFactor/3
  balanceScore: number;    // 0-1, based on DEAD/(DEAD+VALID)
  explorationScore: number; // 0-1, based on non-terminal work
  compositeScore: number;  // Weighted average
}

export class QualityCalculator {
  static calculate(state: InvestigationState): QualityMetrics {
    const nodes = state.getAllNodes();

    if (nodes.length === 0) {
      return {
        maxDepth: 0,
        avgDepth: 0,
        avgBranchingFactor: 0,
        terminalRatio: 0,
        validToDeadRatio: 0,
        depthScore: 0,
        breadthScore: 0,
        balanceScore: 0,
        explorationScore: 0,
        compositeScore: 0,
      };
    }

    // Calculate depth metrics
    const maxDepth = Math.max(...nodes.map((n) => n.round));
    const terminalNodes = nodes.filter((n) => isTerminalState(n.state));
    const avgDepth = terminalNodes.length > 0
      ? terminalNodes.reduce((sum, n) => sum + n.round, 0) / terminalNodes.length
      : 0;

    // Calculate branching factor
    const nodesWithChildren = nodes.filter((n) => n.children.length > 0);
    const avgBranchingFactor = nodesWithChildren.length > 0
      ? nodesWithChildren.reduce((sum, n) => sum + n.children.length, 0) / nodesWithChildren.length
      : 0;

    // Calculate terminal ratio
    const terminalRatio = terminalNodes.length / nodes.length;

    // Calculate VALID to DEAD ratio
    const validCount = nodes.filter((n) => n.state === NodeState.VALID).length;
    const deadCount = nodes.filter((n) => n.state === NodeState.DEAD).length;
    const validToDeadRatio = deadCount > 0 ? validCount / deadCount : validCount;

    // Calculate scores (0-1 scale)
    const depthScore = Math.min(maxDepth / 5, 1);
    const breadthScore = Math.min(avgBranchingFactor / 3, 1);

    // Balance score: more DEAD than VALID is better (means more exploration)
    const balanceScore = (deadCount + validCount) > 0
      ? deadCount / (deadCount + validCount)
      : 0;

    // Exploration score: ratio of non-terminal work before terminating
    const nonTerminalNodes = nodes.filter((n) => !isTerminalState(n.state));
    const explorationScore = nodes.length > 0
      ? nonTerminalNodes.length / nodes.length
      : 0;

    // Composite score: weighted average
    const compositeScore =
      0.30 * depthScore +
      0.30 * breadthScore +
      0.20 * balanceScore +
      0.20 * (1 - explorationScore); // Invert because fewer active = more resolved

    return {
      maxDepth,
      avgDepth,
      avgBranchingFactor,
      terminalRatio,
      validToDeadRatio,
      depthScore,
      breadthScore,
      balanceScore,
      explorationScore,
      compositeScore,
    };
  }
}
