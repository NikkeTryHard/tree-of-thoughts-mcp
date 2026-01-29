export enum NodeState {
  EXPLORE = "EXPLORE", // Needs 2+ children to investigate further
  DEAD = "DEAD", // Dead end, no more exploration needed
  FOUND = "FOUND", // Provisional solution, needs 2+ VERIFY children
  VERIFY = "VERIFY", // Confirms parent FOUND node
  EXHAUST = "EXHAUST", // Exhausted path, needs 1+ DEAD children to confirm
}

export const STATE_COLORS: Record<NodeState, string> = {
  [NodeState.EXPLORE]: "lightblue",
  [NodeState.DEAD]: "red",
  [NodeState.FOUND]: "orange", // Changed from green - provisional
  [NodeState.VERIFY]: "green", // Verified solution
  [NodeState.EXHAUST]: "gray", // Exhausted path awaiting confirmation
};

export function isTerminalState(state: NodeState): boolean {
  return state === NodeState.DEAD || state === NodeState.VERIFY;
}

// EXHAUST requires DEAD children to confirm, not just any children

export function getRequiredChildren(state: NodeState, round: number = 1): number {
  switch (state) {
    case NodeState.EXPLORE:
      return round <= 2 ? 2 : 1; // 2+ at R1-R2, 1+ at R3+
    case NodeState.FOUND:
      return 1; // Was 2, now 1
    case NodeState.EXHAUST:
      return 1; // Needs 1+ DEAD children
    default:
      return 0;
  }
}

export function getValidChildStates(parentState: NodeState): NodeState[] {
  switch (parentState) {
    case NodeState.EXPLORE:
      return [NodeState.EXPLORE, NodeState.FOUND, NodeState.EXHAUST, NodeState.DEAD, NodeState.VERIFY];
    case NodeState.FOUND:
      return [NodeState.EXPLORE, NodeState.FOUND, NodeState.VERIFY]; // NOT EXHAUST, DEAD
    case NodeState.EXHAUST:
      return [NodeState.EXPLORE, NodeState.EXHAUST, NodeState.DEAD]; // NOT FOUND, VERIFY
    default:
      return [];
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
  proposedAt: number; // Unix timestamp when proposed
}

// Input type for commit results (matches schema input)
export interface CommitResultInput {
  nodeId: string;
  state: NodeState;
  findings: string;
  agentId?: string; // Optional but warned if missing
}

export interface Investigation {
  sessionId: string;
  query: string;
  projectDir: string; // For agent verification
  minRoots: number;
  currentRound: number;
  currentBatch: number;
  nodes: Record<string, ToTNode>;
  pendingProposals: Record<string, ProposedNode>;
  usedAgentIds: Record<string, string>; // agentId -> nodeId mapping to prevent reuse
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
