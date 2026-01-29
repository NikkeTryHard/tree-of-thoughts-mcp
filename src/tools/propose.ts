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
    .describe("Array of proposed nodes"),
});

export type ProposeInput = z.infer<typeof proposeInputSchema>;

export interface ProposeResult {
  status: "OK" | "REJECTED";
  errors: ValidationError[];
  warnings: string[];
  approvedNodes: string[];
  message: string;
}

const R2_MIN_NODES = 5;

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
      warnings: [],
      approvedNodes: [],
      message: "Session not found",
    };
  }

  const now = Date.now();
  const proposed: ProposedNode[] = input.nodes.map((n) => ({
    id: n.id,
    parent: n.parent,
    title: n.title,
    plannedAction: n.plannedAction,
    proposedAt: now,
  }));

  // Validate batch (no duplicates, valid parents)
  const errors = Validator.validateProposedBatch(proposed, state);

  if (errors.length > 0) {
    return {
      status: "REJECTED",
      errors,
      warnings: [],
      approvedNodes: [],
      message: `Validation failed with ${errors.length} error(s)`,
    };
  }

  // Check R2 breadth
  const warnings: string[] = [];
  const r2NodesInBatch = input.nodes.filter(n => n.id.startsWith("R2."));
  const existingR2Nodes = state.getAllNodes().filter(n => n.id.startsWith("R2."));
  const totalR2 = r2NodesInBatch.length + existingR2Nodes.length;

  if (r2NodesInBatch.length > 0 && totalR2 < R2_MIN_NODES) {
    warnings.push(`⚠️ WARNING [R2_BREADTH]: R2 will have ${totalR2} nodes (minimum recommended: ${R2_MIN_NODES}). Consider adding more branches.`);
  }

  // Store pending proposals
  state.addPendingProposals(proposed);
  state.save();

  return {
    message: `NEXT: Spawn Task agents for ${proposed.map((n) => n.id).join(", ")}. Then call tot_commit with agentIds.`,
    status: "OK",
    approvedNodes: proposed.map((n) => n.id),
    warnings,
    errors: [],
  };
}
