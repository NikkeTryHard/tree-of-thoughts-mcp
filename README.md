# Tree of Thoughts MCP Server

A Model Context Protocol (MCP) server that enables structured multi-path investigations using a Tree of Thoughts approach. Designed for AI agents to explore complex problems systematically with parallel research paths.

## Features

- **Single Root Paradigm** - Start with one root, branch wide at R2
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

## Workflow (Single Root Paradigm)

```
1. tot_start    → Get sessionId, begin investigation
2. tot_propose  → Declare single root R1.A
3. Spawn agent  → Execute research for R1.A
4. tot_commit   → Submit as EXPLORE
5. tot_propose  → Branch into 3-5 children at R2
6. Repeat       → Continue until R4+ for FOUND, R5+ to end
7. tot_end      → Finalize and get results with references
```

## Node ID Format

```
Round 1: R1.A (single root, parent: null)
Round 2: R2.A1, R2.A2, R2.A3 (branch wide from R1.A)
Round 3: R3.A1a (parent: R2.A1)
Round 4: R4.A1a1 (parent: R3.A1a) - can use FOUND here
Round 5: R5.A1a1a (parent: R4.A1a1) - VERIFY node
```

## Rules

1. **Single root R1.A** - Then branch wide at R2
2. **Minimum 5 rounds** - Cannot end before Round 5
3. **EXPLORE needs 2+ children** - Must branch for thorough coverage
4. **FOUND only at R4+** - Earlier rounds auto-convert to EXPLORE
5. **FOUND needs VERIFY** - Cannot end until findings are verified

## Example

```javascript
// Start investigation
tot_start({ query: "How to optimize database queries?" })

// Round 1: Single root
tot_propose({ sessionId, nodes: [
  { id: "R1.A", parent: null, title: "Query Optimization", plannedAction: "Analyze problem" }
]})
tot_commit({ sessionId, results: [
  { nodeId: "R1.A", state: "EXPLORE", findings: "Found multiple paths...", agentId: "abc-123" }
]})

// Round 2: Branch wide
tot_propose({ sessionId, nodes: [
  { id: "R2.A1", parent: "R1.A", title: "Index Analysis", plannedAction: "Analyze indexes" },
  { id: "R2.A2", parent: "R1.A", title: "Query Patterns", plannedAction: "Review patterns" },
  { id: "R2.A3", parent: "R1.A", title: "Schema Design", plannedAction: "Evaluate schema" }
]})

// Continue through R3, R4...

// Round 4+: Use FOUND
tot_commit({ sessionId, results: [
  { nodeId: "R4.A1a1", state: "FOUND", findings: "Solution: Add composite index...", agentId: "..." }
]})

// Round 5: Verify the finding
tot_propose({ sessionId, nodes: [
  { id: "R5.A1a1a", parent: "R4.A1a1", title: "Verify Index", plannedAction: "Test performance" }
]})
tot_commit({ sessionId, results: [
  { nodeId: "R5.A1a1a", state: "VERIFY", findings: "Confirmed: 10x improvement", agentId: "..." }
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
| DEPTH_ENFORCED | FOUND before R4 (auto-converts)      |

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
