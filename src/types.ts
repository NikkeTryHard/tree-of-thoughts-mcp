export enum NodeState {
  EXPLORE = "EXPLORE", // Needs 2+ children to investigate further
  DEAD = "DEAD", // Dead end, no more exploration needed
  FOUND = "FOUND", // Solution/answer discovered
}

export const STATE_COLORS: Record<NodeState, string> = {
  [NodeState.EXPLORE]: "lightblue",
  [NodeState.DEAD]: "red",
  [NodeState.FOUND]: "green",
};

export function isTerminalState(state: NodeState): boolean {
  return state === NodeState.DEAD || state === NodeState.FOUND;
}

export function getRequiredChildren(state: NodeState): number {
  return state === NodeState.EXPLORE ? 2 : 0;
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
