import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { generateGraph, type TotGraph } from "../state/graph";
import { getRequiredChildren, isTerminalState, NodeState, type ToTNode } from "../types";

const MODES = ["smoke", "deep", "exhaustive"] as const;
type Mode = (typeof MODES)[number];
type Strategy = "balanced" | "exhaustive" | "verify" | "deepen";

export const nextInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  strategy: z.enum(["balanced", "exhaustive", "verify", "deepen"]).default("balanced").describe("balanced=smallest valid next batch, exhaustive=more breadth and combinations, verify=prioritize FOUND verification, deepen=extend active paths."),
  mode: z.enum(MODES).default("deep").describe("smoke=minimal completion path for quick MCP checks, deep=normal investigation, exhaustive=max breadth/combinations."),
  maxTasks: z.number().int().min(1).max(20).default(8).describe("Maximum task specs to return."),
  minRounds: z.number().int().min(1).max(20).optional().describe("Minimum round target. Defaults to 2 for smoke and 5 otherwise."),
  dimensions: z.record(z.string(), z.array(z.string()).min(1)).optional().describe("Optional combination space. Example: {runtime:['bun','node'], storage:['tmp','repo']}. The tool emits unexplored combinations as task specs."),
});

export type NextInput = z.infer<typeof nextInputSchema>;

export interface NextTask {
  id: string;
  parent: string | null;
  title: string;
  plannedAction: string;
  prompt: string;
  expectedCommit: {
    nodeId: string;
    state: NodeState;
    findingsTemplate: string;
    agentId?: string;
  };
}

export interface CombinationCoverage {
  total: number;
  emitted: number;
  remaining: number;
  examples: Record<string, string>[];
}

export interface NextResult {
  status: "OK" | "REJECTED";
  sessionId: string;
  message: string;
  nextCall: "tot_start" | "tot_propose" | "tot_commit" | "tot_end";
  tasks: NextTask[];
  proposePayload?: { sessionId: string; suppressBreadthWarnings?: boolean; nodes: Array<{ id: string; parent: string | null; title: string; plannedAction: string }> };
  instructions: string[];
  blockers: string[];
  graph: TotGraph | null;
  coverage?: CombinationCoverage;
  canEnd: boolean;
  canEndReason?: string;
  minRounds: number;
}

function suffixFor(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function nodeSuffixFor(index: number): string {
  const suffix = suffixFor(index);
  return suffix.length === 1 ? suffix.toLowerCase() : suffix;
}

function childId(parent: ToTNode, index: number): string {
  return `R${parent.round + 1}.${parent.id.split(".")[1]}${nodeSuffixFor(index)}`;
}

function rootTask(query: string): NextTask {
  return {
    id: "R1.A",
    parent: null,
    title: "Root investigation",
    plannedAction: `Map the problem, list major solution/search paths, and identify dimensions to branch: ${query}`,
    prompt: `Investigate the root problem. Return concise findings with evidence, risks, and a ## References section. Do not solve prematurely; identify branches for deeper exploration. Query: ${query}`,
    expectedCommit: {
      nodeId: "R1.A",
      state: NodeState.EXPLORE,
      findingsTemplate: "Summary:\nEvidence:\nBranches:\nRisks:\n\n## References\n- ",
      agentId: "<optional-agent-id>",
    },
  };
}

function renderCombination(combo: Record<string, string>): string {
  return Object.entries(combo).map(([k, v]) => `${k}=${v}`).join(", ");
}

function combinations(dimensions: Record<string, string[]>): Record<string, string>[] {
  const entries = Object.entries(dimensions);
  if (entries.length === 0) return [];

  let acc: Record<string, string>[] = [{}];
  for (const [key, values] of entries) {
    const next: Record<string, string>[] = [];
    for (const base of acc) {
      for (const value of values) {
        next.push({ ...base, [key]: value });
      }
    }
    acc = next;
  }
  return acc;
}

function nodeMentionsCombination(node: ToTNode, combo: Record<string, string>): boolean {
  const haystack = `${node.title}\n${node.findings ?? ""}`;
  return Object.entries(combo).every(([key, value]) => haystack.includes(`${key}=${value}`));
}

function titleFromFindings(parent: ToTNode, fallback: string, siblingIndex: number): string {
  const findings = parent.findings ?? "";
  const branchMatch = findings.match(/(?:Branches|Next|Options|Paths):\s*([^\n]+)/i);
  const listMatches = Array.from(findings.matchAll(/^\s*[-*]\s+(.{4,80})$/gm), (match) => match[1]);
  const candidates = branchMatch?.[1]
    ? branchMatch[1].split(/[,;|]/)
    : listMatches;
  const raw = candidates[siblingIndex] ?? candidates[0];
  if (!raw) return fallback;

  const candidate = raw
    .replace(/^[\d.)\s-]+/, "")
    .replace(/^(Summary|Evidence|Decision|Confidence|Risks|References):\s*/i, "")
    .trim();
  return candidate ? candidate.slice(0, 80) : fallback;
}

function taskCountFor(parent: ToTNode, needed: number, mode: Mode, strategy: Strategy, remaining: number): number {
  if (remaining <= 0) return 0;
  if (parent.state === NodeState.FOUND || parent.state === NodeState.EXHAUST) return needed;
  if (mode === "smoke") return parent.state === NodeState.EXPLORE ? Math.min(1, remaining) : needed;
  if (mode === "exhaustive" || strategy === "exhaustive") return Math.max(needed, Math.min(3, remaining));
  return needed;
}

function taskForParent(parent: ToTNode, index: number, strategy: Strategy, combo?: Record<string, string>): NextTask {
  const id = childId(parent, index);
  const isVerify = parent.state === NodeState.FOUND || strategy === "verify";
  const smokeCandidate = strategy === "balanced" && parent.round >= 1;
  const comboText = combo ? renderCombination(combo) : "";
  const action = combo
    ? `Evaluate combination ${comboText} under parent ${parent.id}`
    : isVerify
      ? `Verify or falsify the FOUND claim in ${parent.id}`
      : titleFromFindings(parent, `Explore a distinct deeper path from ${parent.id}`, index);
  const title = combo ? `Combination: ${comboText}` : isVerify ? `Verify ${parent.title}` : titleFromFindings(parent, `Deepen ${parent.title}`, index);

  return {
    id,
    parent: parent.id,
    title,
    plannedAction: action,
    prompt: `${action.replace(/[.\s]+$/, "")}. Return: Summary, Evidence, Decision, Confidence, Risks, and ## References. Use state FOUND only if this child has a concrete candidate; VERIFY only when confirming a FOUND parent; DEAD only when disproven; otherwise EXPLORE.`,
    expectedCommit: {
      nodeId: id,
      state: isVerify ? NodeState.VERIFY : smokeCandidate ? NodeState.FOUND : NodeState.EXPLORE,
      findingsTemplate: `Summary:\nEvidence:\nDecision:\nConfidence:\nRisks:\n${combo ? `Combination: ${comboText}\n` : ""}\n## References\n- `,
      agentId: "<optional-agent-id>",
    },
  };
}

export async function handleNext(input: NextInput, persistDir: string = "./investigations"): Promise<NextResult> {
  const parsed = nextInputSchema.parse(input);
  const state = InvestigationState.load(parsed.sessionId, persistDir);

  if (!state) {
    return {
      status: "REJECTED",
      sessionId: parsed.sessionId,
      message: "Session not found. Call tot_start first.",
      nextCall: "tot_start",
      tasks: [],
      instructions: ["Call tot_start with the query and projectDir, then call tot_next again."],
      blockers: ["SESSION_NOT_FOUND"],
      graph: null,
      canEnd: false,
      canEndReason: "Session not found",
      minRounds: parsed.minRounds ?? (parsed.mode === "smoke" ? 2 : 5),
    };
  }

  const graph = generateGraph(state);
  const allNodes = state.getAllNodes();
  const mode = parsed.mode ?? state.data.mode ?? "deep";
  const minRounds = parsed.minRounds ?? state.data.minRounds ?? (mode === "smoke" ? 2 : 5);
  if (state.data.mode !== mode || state.data.minRounds !== minRounds) {
    state.data.mode = mode;
    state.data.minRounds = minRounds;
    state.data.allowEarlyTerminal = state.data.allowEarlyTerminal ?? minRounds < 4;
    state.save();
  }
  const relaxExploreChildren = minRounds < 4;
  const structurallyComplete = allNodes.every((node) => isTerminalState(node.state) || node.children.length >= getRequiredChildren(node.state, node.round) || (relaxExploreChildren && node.state === NodeState.EXPLORE && node.children.length > 0));
  const hasVerifiedFound = allNodes.some((node) => node.state === NodeState.FOUND && node.children.some((childId) => state.getNode(childId)?.state === NodeState.VERIFY));
  const canEnd = structurallyComplete && state.data.currentRound >= minRounds && hasVerifiedFound;
  const canEndReason = canEnd ? undefined : state.data.currentRound < minRounds ? `Round ${state.data.currentRound} < ${minRounds}. Continue investigation.` : !structurallyComplete ? "Non-terminal nodes still need children." : "At least one FOUND node needs a VERIFY child.";

  if (allNodes.length === 0) {
    const task = rootTask(state.data.query);
    return buildResult(state.data.sessionId, "Propose the required single root, then run or delegate it.", "tot_propose", [task], graph, undefined, canEnd, canEndReason, minRounds);
  }

  const pending = Object.values(state.data.pendingProposals);
  if (pending.length > 0) {
    const tasks = pending.slice(0, parsed.maxTasks).map((proposal) => ({
      id: proposal.id,
      parent: proposal.parent,
      title: proposal.title,
      plannedAction: proposal.plannedAction,
      prompt: `${proposal.plannedAction}. Return structured findings and a ## References section.`,
      expectedCommit: {
        nodeId: proposal.id,
        state: NodeState.EXPLORE,
        findingsTemplate: "Summary:\nEvidence:\nDecision:\nConfidence:\nRisks:\n\n## References\n- ",
        agentId: "<optional-agent-id>",
      },
    }));
    return buildResult(state.data.sessionId, "Run or delegate pending proposals, then commit observed results.", "tot_commit", tasks, graph, undefined, canEnd, canEndReason, minRounds);
  }

  if (canEnd) {
    return {
      status: "OK",
      sessionId: state.data.sessionId,
      message: "Investigation satisfies structural completion. Call tot_end to persist and return the final graph.",
      nextCall: "tot_end",
      tasks: [],
      instructions: ["Call tot_end now. Do not hand-write the final answer before tot_end returns OK."],
      blockers: [],
      graph,
      canEnd,
      canEndReason,
      minRounds,
    };
  }

  const dimensions = parsed.dimensions ?? {};
  const combos = combinations(dimensions);
  const unexploredCombos = combos.filter((combo) => !allNodes.some((node) => nodeMentionsCombination(node, combo)));
  const parents = allNodes
    .filter((node) => !isTerminalState(node.state))
    .filter((node) => {
      const needsChild = node.children.length < getRequiredChildren(node.state, node.round);
      const relaxedExplore = relaxExploreChildren && node.state === NodeState.EXPLORE && node.children.length > 0;
      return (needsChild && !relaxedExplore) || (parsed.mode !== "smoke" && (parsed.strategy === "exhaustive" || parsed.strategy === "deepen"));
    })
    .sort((a, b) => {
      const priority = (node: ToTNode) => node.state === NodeState.FOUND ? 0 : node.state === NodeState.EXHAUST ? 1 : 2;
      return priority(a) - priority(b) || b.round - a.round || a.id.localeCompare(b.id);
    });

  const tasks: NextTask[] = [];
  for (const parent of parents) {
    const needed = Math.max(1, getRequiredChildren(parent.state, parent.round) - parent.children.length);
    const count = taskCountFor(parent, needed, mode, parsed.strategy, parsed.maxTasks - tasks.length);
    for (let i = 0; i < count && tasks.length < parsed.maxTasks; i++) {
      const combo = unexploredCombos[tasks.length];
      tasks.push(taskForParent(parent, parent.children.length + i, parsed.strategy, combo));
    }
    if (tasks.length >= parsed.maxTasks) break;
  }

  const coverage = combos.length > 0 ? {
    total: combos.length,
    emitted: Math.min(unexploredCombos.length, tasks.length),
    remaining: Math.max(0, unexploredCombos.length - tasks.length),
    examples: unexploredCombos.slice(0, parsed.maxTasks),
  } : undefined;

  return buildResult(state.data.sessionId, "Propose these generated next paths, then run or delegate each approved node.", "tot_propose", tasks, graph, coverage, canEnd, canEndReason, minRounds);
}

function buildResult(sessionId: string, message: string, nextCall: NextResult["nextCall"], tasks: NextTask[], graph: TotGraph, coverage?: CombinationCoverage, canEnd: boolean = false, canEndReason?: string, minRounds: number = 5): NextResult {
  return {
    status: "OK",
    sessionId,
    message,
    nextCall,
    tasks,
    proposePayload: nextCall === "tot_propose" ? {
      sessionId,
      suppressBreadthWarnings: minRounds < 4 || undefined,
      nodes: tasks.map((task) => ({
        id: task.id,
        parent: task.parent,
        title: task.title,
        plannedAction: task.plannedAction,
      })),
    } : undefined,
    instructions: [
      "Use proposePayload exactly for tot_propose when nextCall is tot_propose.",
      "Run each returned task with subagents when useful; main-agent commits are allowed when you did the work directly.",
      "Each agent prompt must demand evidence, confidence, risks, and a ## References section.",
      "Commit only observed findings. Do not fabricate references, files, tests, outcomes, or trace IDs.",
      "Call tot_next after each commit batch; call tot_end only when tot_next says nextCall=tot_end.",
    ],
    blockers: [],
    graph,
    coverage,
    canEnd,
    canEndReason,
    minRounds,
  };
}
