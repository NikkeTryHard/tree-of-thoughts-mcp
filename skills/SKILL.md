---
name: tree-of-thoughts
description: Multi-path investigation with parallel agents
---

# Tree of Thoughts

## CRITICAL: Agent Spawning is MANDATORY

**You MUST spawn a Task agent for EVERY proposed node.** The MCP tracks timing and agentId.

- Commits within 10 seconds of propose trigger SUSPICIOUS warnings
- Missing agentId triggers MISSING_AGENT warnings
- Fabricating findings without research is PROHIBITED

## Workflow

```
1. tot_start → get sessionId
2. tot_propose → declare nodes (max 5 per batch)
3. **SPAWN Task agents for EACH node** ← REQUIRED
4. tot_commit → submit findings with state AND agentId
5. Repeat 2-4 until canEnd=true
6. tot_end → get final results with references
```

## States (4 states)

| State   | Meaning              | Children   | Terminal |
| ------- | -------------------- | ---------- | -------- |
| EXPLORE | Dig deeper           | 2+ any     | No       |
| FOUND   | Provisional solution | 1+ VERIFY  | No       |
| VERIFY  | Confirms FOUND       | 0          | Yes      |
| DEAD    | Dead end             | 0          | Yes      |

**Key:** FOUND is NOT terminal. Every FOUND needs a VERIFY child to confirm it.

## Node IDs

Format: `R[round].[suffix]`

```
Round 1: R1.A, R1.B, R1.C (parent: null)
Round 2: R2.A1, R2.A2 (parent: R1.A)
Round 3: R3.A1a (parent: R2.A1) - can use FOUND here
Round 4: R4.A1a1 (parent: R3.A1a) - VERIFY node
```

## Rules

1. Max 5 nodes per batch
2. Cannot end before round 3
3. EXPLORE nodes need 2+ children
4. **FOUND only at Round 3+** - Earlier rounds auto-convert to EXPLORE
5. **FOUND needs 1+ VERIFY children** - Cannot end until verified
6. Each node requires a real Task agent - no fabrication

## Subagent Prompt Requirements

**CRITICAL:** When spawning Task agents, include in the prompt:

```
At the end of your response, include a REFERENCES section with:
- URLs you visited
- Documentation you read
- Code files you analyzed (with paths)
- Any external sources

Format:
## References
- [title](url) - brief description
- path/to/file.ts - what you found
```

## Example

```javascript
// Start
tot_start({ query: "..." })

// Round 1: Propose roots
tot_propose({ sessionId, nodes: [
  { id: "R1.A", parent: null, title: "...", plannedAction: "..." },
  { id: "R1.B", parent: null, title: "...", plannedAction: "..." },
  { id: "R1.C", parent: null, title: "...", plannedAction: "..." }
]})

// Spawn agents with reference requirement in prompt
// Commit with agentId
tot_commit({ sessionId, results: [
  { nodeId: "R1.A", state: "EXPLORE", findings: "...\n\n## References\n- ...", agentId: "abc-123" },
  { nodeId: "R1.B", state: "DEAD", findings: "...", agentId: "def-456" },
  { nodeId: "R1.C", state: "EXPLORE", findings: "...", agentId: "ghi-789" }
]})

// Round 3+: Can use FOUND
tot_commit({ sessionId, results: [
  { nodeId: "R3.A1a", state: "FOUND", findings: "Solution found...", agentId: "..." }
]})

// Round 4: VERIFY the FOUND
tot_propose({ sessionId, nodes: [
  { id: "R4.A1a1", parent: "R3.A1a", title: "Verify solution", plannedAction: "Confirm findings" }
]})
tot_commit({ sessionId, results: [
  { nodeId: "R4.A1a1", state: "VERIFY", findings: "Confirmed: ...", agentId: "..." }
]})

// Now canEnd=true
tot_end({ sessionId })
```

## Errors

| Error           | Fix                                            |
| --------------- | ---------------------------------------------- |
| NOT_PROPOSED    | Call tot_propose first                         |
| BATCH_OVERFLOW  | Split into batches of 5                        |
| TERMINAL_PARENT | Use tot_reclassify to change parent to EXPLORE |

## Warnings (Anti-Gaming)

| Warning        | Meaning                                             |
| -------------- | --------------------------------------------------- |
| SUSPICIOUS     | Commit too fast after propose - no real research    |
| MISSING_AGENT  | No agentId provided - cannot verify research        |
| DEPTH_ENFORCED | FOUND before R3 converted to EXPLORE - add children |
