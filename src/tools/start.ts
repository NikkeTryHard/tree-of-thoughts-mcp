import { z } from "zod";
import { InvestigationState } from "../state/investigation";

export const startInputSchema = z.object({
  query: z.string().describe("The investigation query/problem to solve"),
});

export type StartInput = z.infer<typeof startInputSchema>;

export interface StartResult {
  sessionId: string;
  query: string;
  currentRound: number;
  instructions: string;
}

export async function handleStart(input: StartInput, persistDir: string = "./investigations"): Promise<StartResult> {
  const query = input.query;

  const state = InvestigationState.create(query, 1, persistDir); // Always 1 root
  state.save();

  return {
    sessionId: state.data.sessionId,
    query: state.data.query,
    currentRound: state.data.currentRound,
    instructions: `Investigation started. Single root paradigm:

1. Call tot_propose with ONE root node: R1.A (the query itself)
2. Spawn agent for R1.A, commit as EXPLORE
3. R1.A must branch into 3-5 children at R2
4. Continue branching until R4+ where you can use FOUND
5. Each FOUND needs a VERIFY child

Rules:
- Single root R1.A, then branch wide at R2
- EXPLORE nodes need 2+ children
- FOUND only at R4+ (auto-converts before)
- FOUND needs 1+ VERIFY children
- Minimum 5 rounds before ending`,
  };
}
