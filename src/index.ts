import { tmpdir } from "os";
import { join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NodeState } from "./types";
import { handleStart, handlePropose, handleCommit, handleReclassify, handleStatus, handleEnd, handleNext, handleStep } from "./tools";

const PERSIST_DIR = process.env.TOT_PERSIST_DIR || join(tmpdir(), "tree-of-thoughts-mcp");
const GRAPH_DIR = process.env.TOT_GRAPH_DIR || PERSIST_DIR;
const STATE_VALUES = ["EXPLORE", "DEAD", "FOUND", "VERIFY", "EXHAUST"] as const;
const STRUCTURED_FINDINGS = "Write findings as: Summary, Evidence, Decision, Confidence, Risks, and ## References bullets. Never invent sources, agent IDs, tests, files, or outcomes.";

const server = new McpServer({
  name: "tree-of-thoughts",
  version: "2.0.0",
});

// tot_start - Begin investigation
server.tool(
  "tot_start",
  "Start a Tree-of-Thoughts investigation. Use for complex agent research where branches, verification, and final graph output matter. Returns sessionId plus protocol instructions. After this, call tot_next to get the exact next propose/commit/end action; do not manually guess the workflow unless you are debugging.",
  {
    query: z.string().describe("The problem to investigate"),
    projectDir: z.string().optional().describe("Current working directory retained for context; agent IDs are not verified."),
    mode: z.enum(["smoke", "deep", "exhaustive"]).optional().describe("Session mode. smoke defaults minRounds=2 and allows early terminal states."),
    minRounds: z.number().int().min(1).max(20).optional().describe("Session minimum round target. Defaults to 2 for smoke and 5 otherwise."),
    allowEarlyTerminal: z.boolean().optional().describe("Allow early FOUND/DEAD/EXHAUST before R4. Defaults true when minRounds < 4."),
  },
  async (input) => {
    const result = await handleStart({ query: input.query, projectDir: input.projectDir ?? "", mode: input.mode, minRounds: input.minRounds, allowEarlyTerminal: input.allowEarlyTerminal }, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// tot_propose - Validate batch before execution
server.tool(
  "tot_propose",
  "Register the next investigation nodes before running work. Prefer using tot_next.proposePayload exactly. Node IDs must be R<round>.<suffix>; one root R1.A. Deep/exhaustive mode expects broad R2 and R3 exploration before terminal states. Smoke/minRounds paths may suppress R2 breadth warnings and allow early FOUND/DEAD/EXHAUST via tot_commit minRounds/allowEarlyTerminal.",
  {
    sessionId: z.string().describe("Session ID"),
    nodes: z
      .array(
        z.object({
          id: z.string().describe("Node ID: R[round].[id] (e.g., R1.A, R2.A1)"),
          parent: z.string().nullable().describe("Parent ID or null for roots"),
          title: z.string().trim().min(1).describe("Required short human-readable node name for graph labels and final output"),
          plannedAction: z.string().describe(`Agent task. Include scope, evidence needed, and expected ${STRUCTURED_FINDINGS}`),
        }),
      )
      .describe("Nodes to propose"),
    suppressBreadthWarnings: z.boolean().optional().describe("Suppress R2 breadth warning for smoke/minRounds paths"),
  },
  async (input) => {
    const result = await handlePropose({ sessionId: input.sessionId, nodes: input.nodes, suppressBreadthWarnings: input.suppressBreadthWarnings }, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// tot_commit - Submit agent results
server.tool(
  "tot_commit",
  "Commit observed results for proposed nodes. State meanings: EXPLORE=needs deeper children, FOUND=provisional candidate at R4+ that must get a child (usually VERIFY), VERIFY=terminal confirmation of a FOUND parent, EXHAUST=path appears exhausted and needs DEAD child confirmation, DEAD=terminal false/dead path at R4+. Use structured findings with evidence and references. agentId is optional trace metadata only; it is not verified or required.",
  {
    sessionId: z.string().describe("Session ID"),
    results: z
      .array(
        z.object({
          nodeId: z.string().describe("Node ID"),
          state: z.enum(STATE_VALUES).describe("EXPLORE, FOUND, VERIFY, EXHAUST, or DEAD. R1-R3 conclusions auto-convert to EXPLORE; R3 must be EXPLORE."),
          findings: z.string().describe(STRUCTURED_FINDINGS),
          agentId: z.string().optional().describe("Optional agent identifier for traceability only; not verified or required"),
        }),
      )
      .describe("Results from agents"),
      minRounds: z.number().int().min(1).max(20).optional().describe("Optional canEnd minimum round override. Use 2 or 3 for smoke tests; default 5."),
      allowEarlyTerminal: z.boolean().optional().describe("Allow FOUND/DEAD/EXHAUST before R4. Defaults true when minRounds < 4."),
  },
  async (input) => {
    const results = input.results.map((r) => ({
      nodeId: r.nodeId,
      state: r.state as NodeState,
      findings: r.findings,
      agentId: r.agentId,
    }));
    const result = await handleCommit({ sessionId: input.sessionId, results, minRounds: input.minRounds, allowEarlyTerminal: input.allowEarlyTerminal }, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// tot_reclassify - Change node state
server.tool(
  "tot_reclassify",
  "Change a node state when new evidence corrects an earlier classification. Valid states: EXPLORE, FOUND, VERIFY, EXHAUST, DEAD. Reclassification cannot hide unresolved children; use it to fix the graph before tot_next/tot_end.",
  {
    sessionId: z.string().describe("Session ID"),
    nodeId: z.string().describe("Node ID"),
    newState: z.enum(STATE_VALUES).describe("New state: EXPLORE, FOUND, VERIFY, EXHAUST, or DEAD"),
  },
  async (input) => {
    const result = await handleReclassify(
      {
        sessionId: input.sessionId,
        nodeId: input.nodeId,
        newState: input.newState as NodeState,
      },
      PERSIST_DIR,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// tot_status - Get current state
server.tool(
  "tot_status",
  "Return current investigation status, blockers, nextAction, and DOT graph. For agent-friendly generated next steps use tot_next; for final persisted graph use tot_end.",
  {
    sessionId: z.string().describe("Session ID"),
  },
  async (input) => {
    const result = await handleStatus({ sessionId: input.sessionId }, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// tot_next - Generate agent-friendly next steps
server.tool(
  "tot_next",
  "Agent-friendly orchestration helper. Call after tot_start and after every commit. It returns nextCall, canEndReason, ready-to-use proposePayload, generated task prompts, commit skeletons, current JSON/DOT graph, and optional combination coverage. mode=smoke defaults minRounds=2 and suppresses breadth warnings; mode=deep is normal; mode=exhaustive maximizes breadth/combinations.",
  {
    sessionId: z.string().describe("Session ID"),
    strategy: z.enum(["balanced", "exhaustive", "verify", "deepen"]).default("balanced").describe("balanced=small valid batch, exhaustive=more breadth/combinations, verify=prioritize FOUND verification, deepen=extend active paths"),
    mode: z.enum(["smoke", "deep", "exhaustive"]).default("deep").describe("smoke=minimal completion path, deep=normal investigation, exhaustive=max breadth/combinations"),
    maxTasks: z.number().int().min(1).max(20).default(8).describe("Maximum generated tasks to return"),
    minRounds: z.number().int().min(1).max(20).optional().describe("Minimum round target. Defaults to 2 for smoke mode and 5 otherwise."),
    dimensions: z.record(z.string(), z.array(z.string().min(1))).optional().describe("Optional combination space. Example: {runtime:['bun','node'], storage:['tmp','repo']}. The tool emits unexplored combinations as proposed paths."),
  },
  async (input) => {
    const result = await handleNext(input, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// tot_step - Consolidated driver
server.tool(
  "tot_step",
  "Preferred compact driver. With no results, returns next tasks. With results, auto-proposes missing nodes, commits observed results, and returns the next action. Use graphMode=summary and verbosity=compact for token-efficient agent loops. Low-level tot_propose/tot_commit/tot_status remain advanced/debug tools.",
  {
    sessionId: z.string().describe("Session ID"),
    results: z.array(z.object({
      nodeId: z.string().describe("Node ID"),
      state: z.enum(STATE_VALUES).describe("EXPLORE, FOUND, VERIFY, EXHAUST, or DEAD"),
      findings: z.string().describe(STRUCTURED_FINDINGS),
      agentId: z.string().optional().describe("Optional trace metadata"),
    })).optional().describe("Observed results to auto-propose if needed and commit"),
    mode: z.enum(["smoke", "deep", "exhaustive"]).optional().describe("Optional persisted mode override"),
    strategy: z.enum(["balanced", "exhaustive", "verify", "deepen"]).default("balanced"),
    maxTasks: z.number().int().min(1).max(20).default(8),
    minRounds: z.number().int().min(1).max(20).optional(),
    graphMode: z.enum(["none", "summary", "full"]).default("summary"),
    verbosity: z.enum(["compact", "full"]).default("compact"),
  },
  async (input) => {
    const result = await handleStep(input, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// tot_end - Finalize investigation
server.tool(
  "tot_end",
  "Finalize the investigation only when tot_status/tot_next says it can end. Returns final solutions, dead ends, references, finalDot, full JSON graph, graphPath, and dotPath. Also writes <sessionId>.tot-graph.json and <sessionId>.tot-graph.dot under TOT_GRAPH_DIR or the machine tmp folder by default.",
  {
    sessionId: z.string().describe("Session ID"),
    minRounds: z.number().int().min(1).max(20).optional().describe("Optional minimum round override. Use 2 or 3 for smoke tests; default 5."),
  },
  async (input) => {
    const result = await handleEnd({ sessionId: input.sessionId, minRounds: input.minRounds }, PERSIST_DIR, GRAPH_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("Tree of Thoughts MCP Server v2.0 running");
