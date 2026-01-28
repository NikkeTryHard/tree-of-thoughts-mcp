export enum NodeState {
  DRILL = "DRILL",
  VERIFY = "VERIFY",
  DEAD = "DEAD",
  VALID = "VALID",
  VALID_PENDING = "VALID_PENDING",
  SPEC = "SPEC",
}

export const STATE_COLORS: Record<NodeState, string> = {
  [NodeState.DRILL]: "lightblue",
  [NodeState.VERIFY]: "purple",
  [NodeState.DEAD]: "red",
  [NodeState.VALID]: "green",
  [NodeState.VALID_PENDING]: "lightgreen",
  [NodeState.SPEC]: "gold",
};

export function isTerminalState(state: NodeState): boolean {
  return [NodeState.DEAD, NodeState.VALID, NodeState.SPEC].includes(state);
}

export function isPendingState(state: NodeState): boolean {
  return state === NodeState.VALID_PENDING;
}

export function getRequiredChildren(state: NodeState): number {
  switch (state) {
    case NodeState.DRILL:
      return 3; // Increased from 2
    case NodeState.VERIFY:
      return 1;
    case NodeState.VALID_PENDING:
      return 1; // Needs confirmation child
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
  evidence?: string;
  verificationMethod?: string;
  alternativesConsidered?: string[];
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
  totalBatchesInRound: number;
  nodesInQueue: number;
  activeDrills: number;
  activeVerifies: number;
  terminalNodes: number;
  canEnd: boolean;
  dot: string;
}
