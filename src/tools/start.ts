import { z } from "zod";
import { InvestigationState } from "../state/investigation";

export const startInputSchema = z.object({
  query: z.string().describe("The investigation query/problem to solve"),
  minRoots: z.number().min(1).default(5).describe("Minimum number of root nodes in Round 1 (default: 5)"),
});

export type StartInput = z.infer<typeof startInputSchema>;

export interface StartResult {
  sessionId: string;
  query: string;
  minRoots: number;
  currentRound: number;
  instructions: string;
}

export async function handleStart(input: StartInput, persistDir: string = "./investigations"): Promise<StartResult> {
  const query = input.query;
  const minRoots = input.minRoots ?? 5;

  const state = InvestigationState.create(query, minRoots, persistDir);
  state.save();

  return {
    sessionId: state.data.sessionId,
    query: state.data.query,
    minRoots: state.data.minRoots,
    currentRound: state.data.currentRound,
    instructions: `Investigation started. You must now:
1. Call tot_propose with ${minRoots} root nodes (R1.A, R1.B, R1.C, ...)
2. Each root node needs: id, parent (null for roots), title, plannedAction
3. After propose succeeds, spawn your agents
4. Call tot_commit with results when agents complete

Rules:
- Maximum 5 nodes per batch
- EXPLORE nodes require >= 2 children
- DEAD/FOUND are terminal (no children)
- Minimum 3 rounds before ending`,
  };
}
