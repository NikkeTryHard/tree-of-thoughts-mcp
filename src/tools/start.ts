import { z } from "zod";
import { InvestigationState } from "../state/investigation";

export const startInputSchema = z.object({
  query: z.string().describe("The investigation query/problem to solve"),
  projectDir: z.string().optional().describe("Current working directory retained for context; agent IDs are not verified."),
  mode: z.enum(["smoke", "deep", "exhaustive"]).optional().describe("Session mode. smoke defaults minRounds=2 and allows early terminal states; deep/exhaustive default minRounds=5."),
  minRounds: z.number().int().min(1).max(20).optional().describe("Session minimum round target. Defaults to 2 for smoke, 5 otherwise."),
  allowEarlyTerminal: z.boolean().optional().describe("Session default for allowing FOUND/DEAD/EXHAUST before R4. Defaults true when minRounds < 4."),
});

export type StartInput = z.infer<typeof startInputSchema>;

export interface StartResult {
  sessionId: string;
  query: string;
  currentRound: number;
  instructions: string;
  mode: "smoke" | "deep" | "exhaustive";
  minRounds: number;
  allowEarlyTerminal: boolean;
}

export async function handleStart(input: StartInput, persistDir: string = "./investigations"): Promise<StartResult> {
  const query = input.query;
  const mode = input.mode ?? "deep";
  const minRounds = input.minRounds ?? (mode === "smoke" ? 2 : 5);
  const allowEarlyTerminal = input.allowEarlyTerminal ?? minRounds < 4;

  const state = InvestigationState.create(query, 1, persistDir, input.projectDir ?? "", { mode, minRounds, allowEarlyTerminal });
  state.save();

  return {
    instructions: `Preferred loop: call tot_step. With no results it returns compact next tasks; with results it auto-proposes missing nodes, commits, and returns the next action.

Use low-level tot_next/tot_propose/tot_commit only when you need explicit fanout approval or debug control.

Protocol rules kept in MCP tool descriptions and outputs:
- Start with one root R1.A.
- Default deep/exhaustive mode: R1-R2 EXPLORE nodes require 2 children; R3+ EXPLORE nodes require 1 child; R3 is exploration-only; FOUND, EXHAUST, and DEAD before R4 auto-convert to EXPLORE.
- Smoke mode: minRounds defaults to 2 and early terminal states are allowed by default.
- FOUND is provisional and needs at least one child, normally VERIFY.
- EXHAUST needs at least one DEAD child before the investigation can end.
- Do not call tot_end until tot_step or tot_next says ending is allowed.
- tot_end returns finalDot, a full JSON graph, graphPath, and dotPath; it also persists graph files.

Agent output contract:
- Commit only observed work.
- Findings should include Summary, Evidence, Decision, Confidence, Risks, and ## References bullets.
- Never fabricate sources, files, tests, outcomes, or trace IDs.

Compact loop:
1. Call tot_step({ sessionId }).
2. Do returned task work.
3. Call tot_step({ sessionId, results }).
4. Repeat until next.nextCall=tot_end.
5. Call tot_end and use the returned persisted graph/result.`,
    sessionId: state.data.sessionId,
    query: state.data.query,
    currentRound: state.data.currentRound,
    mode,
    minRounds,
    allowEarlyTerminal,
  };
}
