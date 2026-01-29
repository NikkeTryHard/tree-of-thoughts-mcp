import { z } from "zod";
import { InvestigationState } from "../state/investigation";

export const startInputSchema = z.object({
  query: z.string().describe("The investigation query/problem to solve"),
  projectDir: z.string().describe("Current working directory (from pwd). Used to verify agent files exist."),
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

  const state = InvestigationState.create(query, 1, persistDir, input.projectDir);
  state.save();

  return {
    instructions: `MANDATORY: Complete ALL steps. Do NOT present results without calling tot_end.

⚠️ CRITICAL RULE: Every EXPLORE node MUST have 2+ children.
- If you create an EXPLORE node, you MUST propose at least 2 children for it
- tot_end will REJECT if any EXPLORE node has < 2 children
- This is NOT optional - incomplete EXPLORE nodes block completion

🚨 VERIFICATION ENABLED: agentIds will be verified against ~/.claude/projects/.
- Fake agentIds will be REJECTED
- You MUST spawn real Task agents and use their agentId

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
