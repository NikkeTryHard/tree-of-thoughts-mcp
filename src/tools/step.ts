import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { NodeState } from "../types";
import { handleCommit, type CommitResult } from "./commit";
import { handleNext, type NextResult, type NextTask } from "./next";
import { handlePropose, type ProposeResult } from "./propose";

const stepResultSchema = z.object({
  nodeId: z.string(),
  state: z.nativeEnum(NodeState),
  findings: z.string(),
  agentId: z.string().optional(),
});

export const stepInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  results: z.array(stepResultSchema).optional().describe("Optional observed results to commit. If omitted, returns next action only."),
  mode: z.enum(["smoke", "deep", "exhaustive"]).optional().describe("Optional mode override persisted to the session."),
  strategy: z.enum(["balanced", "exhaustive", "verify", "deepen"]).default("balanced"),
  maxTasks: z.number().int().min(1).max(20).default(8),
  minRounds: z.number().int().min(1).max(20).optional(),
  graphMode: z.enum(["none", "summary", "full"]).default("summary"),
  verbosity: z.enum(["compact", "full"]).default("compact"),
});

export type StepInput = z.infer<typeof stepInputSchema>;

export interface CompactTask {
  id: string;
  parent: string | null;
  title: string;
  plannedAction: string;
  stateHint: NodeState;
}

export interface CompactPending {
  nodeId: string;
  state: NodeState;
  needs: string;
}

export interface StepResult {
  status: "OK" | "REJECTED";
  nextCall: "work" | "tot_end";
  tasks: CompactTask[];
  canEnd: boolean;
  pending: CompactPending[];
  message?: string;
  graph?: unknown;
  proposed?: ProposeResult;
  committed?: CommitResult;
  next?: NextResult;
}

export async function handleStep(input: StepInput, persistDir: string = "./investigations"): Promise<StepResult> {
  const parsed = stepInputSchema.parse(input);
  const state = InvestigationState.load(parsed.sessionId, persistDir);

  if (!state) {
    return {
      status: "REJECTED",
      nextCall: "work",
      tasks: [],
      canEnd: false,
      pending: [],
      message: "Session not found",
    };
  }

  const mode = parsed.mode ?? state.data.mode ?? "deep";
  const minRounds = parsed.minRounds ?? state.data.minRounds ?? (mode === "smoke" ? 2 : 5);
  state.data.mode = mode;
  state.data.minRounds = minRounds;
  state.data.allowEarlyTerminal = state.data.allowEarlyTerminal ?? minRounds < 4;
  state.save();

  let proposed: ProposeResult | undefined;
  let committed: CommitResult | undefined;

  if (parsed.results && parsed.results.length > 0) {
    const nextBeforeCommit = await handleNext({ sessionId: parsed.sessionId, mode, strategy: parsed.strategy, maxTasks: parsed.maxTasks, minRounds }, persistDir);
    const taskById = new Map(nextBeforeCommit.tasks.map((task) => [task.id, task]));
    const toPropose = parsed.results
      .filter((result) => !state.getNode(result.nodeId) && !state.getPendingProposal(result.nodeId))
      .map((result) => proposalForResult(result.nodeId, taskById.get(result.nodeId)));

    if (toPropose.length > 0) {
      proposed = await handlePropose({ sessionId: parsed.sessionId, nodes: toPropose, suppressBreadthWarnings: minRounds < 4 }, persistDir);
      if (proposed.status === "REJECTED") {
        const next = await handleNext({ sessionId: parsed.sessionId, mode, strategy: parsed.strategy, maxTasks: parsed.maxTasks, minRounds }, persistDir);
        return compactStep("REJECTED", "Auto-propose rejected", next, parsed, proposed, committed);
      }
    }

    committed = await handleCommit({
      sessionId: parsed.sessionId,
      minRounds,
      allowEarlyTerminal: state.data.allowEarlyTerminal,
      suppressTimingWarnings: true,
      results: parsed.results,
    }, persistDir);
  }

  const next = await handleNext({ sessionId: parsed.sessionId, mode, strategy: parsed.strategy, maxTasks: parsed.maxTasks, minRounds }, persistDir);
  return compactStep(committed?.status ?? "OK", committed?.message ?? next.message, next, parsed, proposed, committed);
}

function proposalForResult(nodeId: string, task: NextTask | undefined): { id: string; parent: string | null; title: string; plannedAction: string } {
  return {
    id: nodeId,
    parent: task?.parent ?? inferParentId(nodeId),
    title: task?.title ?? titleForNode(nodeId),
    plannedAction: task?.plannedAction ?? `Auto-proposed by tot_step for ${nodeId}`,
  };
}

function inferParentId(nodeId: string): string | null {
  const match = nodeId.match(/^R(\d+)\.([A-Za-z0-9]+)$/);
  if (!match) return null;
  const round = Number(match[1]);
  const suffix = match[2];
  if (round <= 1) return null;
  const parentSuffix = suffix.slice(0, -1);
  return parentSuffix.length === 0 ? null : `R${round - 1}.${parentSuffix}`;
}

function titleForNode(nodeId: string): string {
  const parent = inferParentId(nodeId);
  return parent ? `Verify ${parent}` : "Root investigation";
}

function compactStep(status: StepResult["status"], message: string, next: NextResult, input: StepInput, proposed?: ProposeResult, committed?: CommitResult): StepResult {
  if (input.verbosity === "full") {
    return {
      status,
      message,
      nextCall: next.nextCall === "tot_end" ? "tot_end" : "work",
      tasks: compactTasks(next.tasks),
      canEnd: next.canEnd,
      pending: compactPending(committed),
      graph: shapeGraph(next, input.graphMode),
      proposed,
      committed,
      next,
    };
  }

  return {
    status,
    nextCall: next.nextCall === "tot_end" ? "tot_end" : "work",
    tasks: compactTasks(next.tasks),
    canEnd: next.canEnd,
    pending: compactPending(committed),
    ...(message ? { message } : {}),
    ...(input.graphMode === "none" ? {} : { graph: shapeGraph(next, input.graphMode) }),
  };
}

function compactTasks(tasks: NextTask[]): CompactTask[] {
  return tasks.map((task) => ({
    id: task.id,
    parent: task.parent,
    title: task.title,
    plannedAction: task.plannedAction,
    stateHint: task.expectedCommit.state,
  }));
}

function compactPending(committed: CommitResult | undefined): CompactPending[] {
  return committed?.pendingNonTerminal.map((node) => ({
    nodeId: node.nodeId,
    state: node.state,
    needs: node.childLabel,
  })) ?? [];
}

function shapeGraph(next: NextResult, graphMode: "none" | "summary" | "full"): unknown {
  if (graphMode === "none" || !next.graph) return undefined;
  if (graphMode === "full") return next.graph;

  const latest = next.graph.nodes.slice(-5).map((node) => ({
    id: node.id,
    parent: node.parent,
    state: node.state,
    title: node.title,
    round: node.round,
    children: node.children,
  }));
  const ids = new Set(latest.map((node) => node.id));

  return {
    totalNodes: next.graph.totalNodes,
    currentRound: next.graph.currentRound,
    nodes: latest,
    edges: next.graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
  };
}
