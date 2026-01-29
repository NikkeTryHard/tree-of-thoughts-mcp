import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator } from "../state/validation";
import { DotGenerator } from "../state/dot-generator";
import { NodeState, type ValidationError } from "../types";

export const reclassifyInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  nodeId: z.string().describe("The node ID to reclassify"),
  newState: z.nativeEnum(NodeState).describe("The new state for the node"),
});

export type ReclassifyInput = z.infer<typeof reclassifyInputSchema>;

export interface ReclassifyResult {
  status: "OK" | "REJECTED";
  errors: ValidationError[];
  nodeId: string;
  previousState: NodeState | null;
  newState: NodeState;
  dot: string;
  message: string;
}

export async function handleReclassify(
  input: ReclassifyInput,
  persistDir: string = "./investigations"
): Promise<ReclassifyResult> {
  const state = InvestigationState.load(input.sessionId, persistDir);

  if (!state) {
    return {
      status: "REJECTED",
      errors: [
        {
          nodeId: "SESSION",
          error: "SESSION_NOT_FOUND",
          message: `Investigation ${input.sessionId} not found`,
        },
      ],
      nodeId: input.nodeId,
      previousState: null,
      newState: input.newState,
      dot: "",
      message: "Session not found",
    };
  }

  const node = state.getNode(input.nodeId);
  if (!node) {
    return {
      status: "REJECTED",
      errors: [
        {
          nodeId: input.nodeId,
          error: "NODE_NOT_FOUND",
          message: `Node ${input.nodeId} does not exist`,
        },
      ],
      nodeId: input.nodeId,
      previousState: null,
      newState: input.newState,
      dot: DotGenerator.generate(state),
      message: "Node not found",
    };
  }

  const errors = Validator.validateReclassification(input.nodeId, input.newState, state);

  if (errors.length > 0) {
    return {
      status: "REJECTED",
      errors,
      nodeId: input.nodeId,
      previousState: node.state,
      newState: input.newState,
      dot: DotGenerator.generate(state),
      message: `Cannot reclassify: ${errors.map((e) => e.message).join("; ")}`,
    };
  }

  const previousState = node.state;
  state.updateNode(input.nodeId, { state: input.newState });
  state.save();

  return {
    message: `Node ${input.nodeId} reclassified from ${previousState} to ${input.newState}`,
    status: "OK",
    errors: [],
    nodeId: input.nodeId,
    previousState,
    newState: input.newState,
    dot: DotGenerator.generate(state),
  };
}
