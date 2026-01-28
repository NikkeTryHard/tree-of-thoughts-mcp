import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator } from "../state/validation";
import type { ProposedNode, ValidationError } from "../types";

export const proposeInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  nodes: z
    .array(
      z.object({
        id: z.string().describe("Node ID in format R[round].[id]"),
        parent: z.string().nullable().describe("Parent node ID or null for roots"),
        title: z.string().describe("Short title describing this node's focus"),
        plannedAction: z.string().describe("What the agent will investigate"),
      }),
    )
    .describe("Array of proposed nodes (max 5)"),
});

export type ProposeInput = z.infer<typeof proposeInputSchema>;

export interface ProposeResult {
  status: "OK" | "REJECTED";
  errors: ValidationError[];
  approvedNodes: string[];
  message: string;
}

export async function handlePropose(input: ProposeInput, persistDir: string = "./investigations"): Promise<ProposeResult> {
  const state = InvestigationState.load(input.sessionId, persistDir);

  if (!state) {
    return {
      status: "REJECTED",
      errors: [
        {
          nodeId: "SESSION",
          error: "SESSION_NOT_FOUND",
          message: `Investigation ${input.sessionId} not found`,
          suggestion: "Call tot_start first",
        },
      ],
      approvedNodes: [],
      message: "Session not found",
    };
  }

  const proposed: ProposedNode[] = input.nodes.map((n) => ({
    id: n.id,
    parent: n.parent,
    title: n.title,
    plannedAction: n.plannedAction,
  }));

  // Validate batch (max 5, no duplicates, valid parents)
  const errors = Validator.validateProposedBatch(proposed, state);

  if (errors.length > 0) {
    return {
      status: "REJECTED",
      errors,
      approvedNodes: [],
      message: `Validation failed with ${errors.length} error(s)`,
    };
  }

  // Store pending proposals
  state.addPendingProposals(proposed);
  state.save();

  return {
    status: "OK",
    errors: [],
    approvedNodes: proposed.map((n) => n.id),
    message: `Approved: ${proposed.map((n) => n.id).join(", ")}. Spawn agents, then call tot_commit.`,
  };
}
