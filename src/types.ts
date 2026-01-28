export enum NodeState {
  EXPLORE = "EXPLORE", // Needs 2+ children to investigate further
  DEAD = "DEAD", // Dead end, no more exploration needed
  FOUND = "FOUND", // Provisional solution, needs 1+ VERIFY children
  VERIFY = "VERIFY", // Confirms parent FOUND node
}

export const STATE_COLORS: Record<NodeState, string> = {
  [NodeState.EXPLORE]: "lightblue",
  [NodeState.DEAD]: "red",
  [NodeState.FOUND]: "orange", // Changed from green - provisional
  [NodeState.VERIFY]: "green", // Verified solution
};

export function isTerminalState(state: NodeState): boolean {
  return state === NodeState.DEAD || state === NodeState.VERIFY;
}

export function getRequiredChildren(state: NodeState): number {
  switch (state) {
    case NodeState.EXPLORE:
      return 2;
    case NodeState.FOUND:
      return 1; // Needs VERIFY child
    default:
      return 0;
  }
}

export interface ToTNode {
  id: string;
  parent: string | null;
  state: NodeState;
  title: string;
  findings: string | null;
  children: string[];
  round: number;
}

export interface ProposedNode {
  id: string;
  parent: string | null;
  title: string;
  plannedAction: string;
}

export interface CommitResult {
  nodeId: string;
  state: NodeState;
  findings: string;
}

export interface Investigation {
  sessionId: string;
  query: string;
  minRoots: number;
  currentRound: number;
  currentBatch: number;
  nodes: Record<string, ToTNode>;
  pendingProposals: Record<string, ProposedNode>;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationError {
  nodeId: string;
  error: string;
  message: string;
  suggestion?: string;
}

export interface BatchStatus {
  sessionId: string;
  currentRound: number;
  currentBatch: number;
  nodesInQueue: number;
  activeExplore: number;
  terminalNodes: number;
  canEnd: boolean;
  dot: string;
}
