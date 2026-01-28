import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NodeState } from "./types";
import {
  handleStart,
  handlePropose,
  handleCommit,
  handleReclassify,
  handleStatus,
  handleEnd,
} from "./tools";

const PERSIST_DIR = process.env.TOT_PERSIST_DIR || "./investigations";

const server = new McpServer({
  name: "tree-of-thoughts",
  version: "1.0.0",
});

// tot_start - Begin investigation
server.tool(
  "tot_start",
  "Start a new Tree of Thoughts investigation. Returns session ID and instructions.",
  {
    query: z.string().describe("The problem/question to investigate"),
    minRoots: z
      .number()
      .min(1)
      .optional()
      .describe("Minimum root nodes in Round 1 (default: 5)"),
  },
  async (input) => {
    const result = await handleStart(
      { query: input.query, minRoots: input.minRoots ?? 5 },
      PERSIST_DIR
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// tot_propose - Validate batch before execution
server.tool(
  "tot_propose",
  "Validate a batch of nodes before spawning agents. Returns OK or REJECTED with errors.",
  {
    sessionId: z.string().describe("The investigation session ID"),
    nodes: z
      .array(
        z.object({
          id: z.string().describe("Node ID (format: R[round].[id])"),
          parent: z.string().nullable().describe("Parent node ID or null"),
          title: z.string().describe("Short title for this node"),
          plannedAction: z.string().describe("What the agent will do"),
        })
      )
      .describe("Nodes to propose (max 5)"),
  },
  async (input) => {
    const result = await handlePropose(
      {
        sessionId: input.sessionId,
        nodes: input.nodes,
      },
      PERSIST_DIR
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// tot_commit - Submit agent results
server.tool(
  "tot_commit",
  "Submit completed agent results. Returns updated graph and next round requirements.",
  {
    sessionId: z.string().describe("The investigation session ID"),
    results: z
      .array(
        z.object({
          nodeId: z.string().describe("The node ID"),
          state: z.enum(["DRILL", "VERIFY", "DEAD", "VALID", "VALID_PENDING", "SPEC"]).describe("Result state"),
          findings: z.string().describe("What was discovered"),
        })
      )
      .describe("Results from executed agents"),
  },
  async (input) => {
    const results = input.results.map((r) => ({
      nodeId: r.nodeId,
      state: r.state as NodeState,
      findings: r.findings,
    }));
    const result = await handleCommit(
      { sessionId: input.sessionId, results },
      PERSIST_DIR
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// tot_reclassify - Change node state
server.tool(
  "tot_reclassify",
  "Change a node's state. Use to revive terminal nodes or correct misclassifications.",
  {
    sessionId: z.string().describe("The investigation session ID"),
    nodeId: z.string().describe("The node ID to reclassify"),
    newState: z.enum(["DRILL", "VERIFY", "DEAD", "VALID", "SPEC"]).describe("New state"),
  },
  async (input) => {
    const result = await handleReclassify(
      {
        sessionId: input.sessionId,
        nodeId: input.nodeId,
        newState: input.newState as NodeState,
      },
      PERSIST_DIR
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// tot_status - Get current state
server.tool(
  "tot_status",
  "Get current investigation status including graph, queue, and next actions.",
  {
    sessionId: z.string().describe("The investigation session ID"),
  },
  async (input) => {
    const result = await handleStatus({ sessionId: input.sessionId }, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// tot_end - Finalize investigation
server.tool(
  "tot_end",
  "Finalize the investigation. Returns final graph, solutions, and theories.",
  {
    sessionId: z.string().describe("The investigation session ID"),
  },
  async (input) => {
    const result = await handleEnd({ sessionId: input.sessionId }, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("Tree of Thoughts MCP Server running on stdio");
