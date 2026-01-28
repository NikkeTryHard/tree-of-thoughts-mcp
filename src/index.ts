import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NodeState } from "./types";
import { handleStart, handlePropose, handleCommit, handleReclassify, handleStatus, handleEnd } from "./tools";

const PERSIST_DIR = process.env.TOT_PERSIST_DIR || "./investigations";

const server = new McpServer({
  name: "tree-of-thoughts",
  version: "2.0.0",
});

// tot_start - Begin investigation
server.tool(
  "tot_start",
  "Start investigation. Returns sessionId.",
  {
    query: z.string().describe("The problem to investigate"),
    minRoots: z.number().min(1).optional().describe("Min root nodes (default: 3)"),
  },
  async (input) => {
    const result = await handleStart({ query: input.query, minRoots: input.minRoots ?? 3 }, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// tot_propose - Validate batch before execution
server.tool(
  "tot_propose",
  "Propose nodes (max 5). Returns OK or REJECTED.",
  {
    sessionId: z.string().describe("Session ID"),
    nodes: z
      .array(
        z.object({
          id: z.string().describe("Node ID: R[round].[id] (e.g., R1.A, R2.A1)"),
          parent: z.string().nullable().describe("Parent ID or null for roots"),
          title: z.string().describe("Short title"),
          plannedAction: z.string().describe("What to investigate"),
        }),
      )
      .describe("Nodes to propose (max 5)"),
  },
  async (input) => {
    const result = await handlePropose({ sessionId: input.sessionId, nodes: input.nodes }, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// tot_commit - Submit agent results
server.tool(
  "tot_commit",
  "Submit results. States: EXPLORE (needs 2+ children), FOUND (needs 1+ VERIFY, R3+ only), VERIFY (confirms FOUND), DEAD.",
  {
    sessionId: z.string().describe("Session ID"),
    results: z
      .array(
        z.object({
          nodeId: z.string().describe("Node ID"),
          state: z.enum(["EXPLORE", "DEAD", "FOUND", "VERIFY"]).describe("EXPLORE=dig deeper (2+ children), FOUND=provisional solution (1+ VERIFY child, R3+ only), VERIFY=confirms FOUND, DEAD=dead end"),
          findings: z.string().describe("What was discovered"),
        }),
      )
      .describe("Results from agents"),
  },
  async (input) => {
    const results = input.results.map((r) => ({
      nodeId: r.nodeId,
      state: r.state as NodeState,
      findings: r.findings,
    }));
    const result = await handleCommit({ sessionId: input.sessionId, results }, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// tot_reclassify - Change node state
server.tool(
  "tot_reclassify",
  "Change a node's state.",
  {
    sessionId: z.string().describe("Session ID"),
    nodeId: z.string().describe("Node ID"),
    newState: z.enum(["EXPLORE", "DEAD", "FOUND", "VERIFY"]).describe("New state"),
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
  "Get investigation status.",
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

// tot_end - Finalize investigation
server.tool(
  "tot_end",
  "End investigation. Requires round >= 3 and all EXPLORE nodes resolved.",
  {
    sessionId: z.string().describe("Session ID"),
  },
  async (input) => {
    const result = await handleEnd({ sessionId: input.sessionId }, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("Tree of Thoughts MCP Server v2.0 running");
