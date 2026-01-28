# Tree of Thoughts MCP Server

A Model Context Protocol (MCP) server that enables structured multi-path investigations using a Tree of Thoughts approach. Designed for AI agents to explore complex problems systematically with parallel research paths.

## Features

- **Structured Investigation** - Organize research into rounds with parent-child relationships
- **4-State System** - EXPLORE, FOUND, VERIFY, DEAD states enforce thorough investigation
- **Anti-Gaming Measures** - Timing checks and agentId tracking prevent shortcut-taking
- **Reference Extraction** - Automatically collects URLs and file paths from findings
- **DOT Graph Output** - Visualize investigation tree structure

## Installation

```bash
# Clone the repository
git clone https://github.com/NikkeTryHard/tree-of-thoughts-mcp.git
cd tree-of-thoughts-mcp

# Install dependencies
bun install

# Build
bun run build
```

## Configuration

Add to your Claude Code MCP settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "tree-of-thoughts": {
      "command": "node",
      "args": ["/path/to/tree-of-thoughts-mcp/dist/index.js"]
    }
  }
}
```

## State Machine

| State   | Meaning              | Children Required | Terminal |
|---------|----------------------|-------------------|----------|
| EXPLORE | Dig deeper           | 2+                | No       |
| FOUND   | Provisional solution | 1+ VERIFY         | No       |
| VERIFY  | Confirms FOUND       | 0                 | Yes      |
| DEAD    | Dead end             | 0                 | Yes      |

**Key insight:** FOUND is NOT terminal. Every promising finding must be verified before the investigation can end.

## Workflow

```
1. tot_start    → Get sessionId, begin investigation
2. tot_propose  → Declare nodes to investigate (max 5 per batch)
3. Spawn agents → Execute research for each node
4. tot_commit   → Submit findings with state and agentId
5. Repeat 2-4   → Until canEnd=true
6. tot_end      → Finalize and get results with references
```

## Node ID Format

```
Round 1: R1.A, R1.B, R1.C (parent: null)
Round 2: R2.A1, R2.A2 (parent: R1.A)
Round 3: R3.A1a (parent: R2.A1) - can use FOUND here
Round 4: R4.A1a1 (parent: R3.A1a) - VERIFY node
```

## Rules

1. **Max 5 nodes per batch** - Split larger investigations
2. **Minimum 3 rounds** - Cannot end before Round 3
3. **EXPLORE needs 2+ children** - Must branch for thorough coverage
4. **FOUND only at R3+** - Earlier rounds auto-convert to EXPLORE
5. **FOUND needs VERIFY** - Cannot end until findings are verified

## Example

```javascript
// Start investigation
tot_start({ query: "How to optimize database queries?" })

// Round 1: Propose root paths
tot_propose({ sessionId, nodes: [
  { id: "R1.A", parent: null, title: "Index Analysis", plannedAction: "Analyze missing indexes" },
  { id: "R1.B", parent: null, title: "Query Patterns", plannedAction: "Review query patterns" },
  { id: "R1.C", parent: null, title: "Schema Design", plannedAction: "Evaluate schema" }
]})

// Spawn Task agents for each node, then commit
tot_commit({ sessionId, results: [
  { nodeId: "R1.A", state: "EXPLORE", findings: "Found 3 missing indexes...", agentId: "abc-123" },
  { nodeId: "R1.B", state: "DEAD", findings: "Queries already optimized", agentId: "def-456" },
  { nodeId: "R1.C", state: "EXPLORE", findings: "Normalization issues...", agentId: "ghi-789" }
]})

// Continue until Round 3+, then use FOUND
tot_commit({ sessionId, results: [
  { nodeId: "R3.A1a", state: "FOUND", findings: "Solution: Add composite index on...", agentId: "..." }
]})

// Verify the finding
tot_propose({ sessionId, nodes: [
  { id: "R4.A1a1", parent: "R3.A1a", title: "Verify Index", plannedAction: "Test performance" }
]})
tot_commit({ sessionId, results: [
  { nodeId: "R4.A1a1", state: "VERIFY", findings: "Confirmed: 10x improvement", agentId: "..." }
]})

// End when canEnd=true
tot_end({ sessionId })
```

## Anti-Gaming Measures

The server includes protections against agents taking shortcuts:

| Warning        | Trigger                              |
|----------------|--------------------------------------|
| SUSPICIOUS     | Commit within 10s of propose         |
| MISSING_AGENT  | No agentId provided                  |
| DEPTH_ENFORCED | FOUND before R3 (auto-converts)      |

## Claude Code Skill

Copy `skills/SKILL.md` to `~/.claude/skills/tree-of-thoughts/SKILL.md` to enable the `/tree-of-thoughts` command in Claude Code.

## Development

```bash
# Run tests
bun test

# Build
bun run build
```

See [CLAUDE.md](./CLAUDE.md) for development guidelines.

## License

MIT
