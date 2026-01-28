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
    instructions: `MANDATORY: Complete ALL steps. Do NOT present results without calling tot_end.

1. Call tot_propose with ONE root node: R1.A
2. Spawn agent for R1.A, commit as EXPLORE
3. Branch into 3-5 children at R2
4. Continue to R4+ where you can use FOUND
5. Add VERIFY child for each FOUND
6. Continue until Round 5+ and canEnd=true
7. MUST call tot_end to finalize - NO EXCEPTIONS

Rules:
- FOUND only at R4+ (auto-converts before)
- FOUND needs 1+ VERIFY children
- Minimum 5 rounds before tot_end
- Stopping early is PROTOCOL VIOLATION`,
    sessionId: state.data.sessionId,
    query: state.data.query,
    currentRound: state.data.currentRound,
  };
}
