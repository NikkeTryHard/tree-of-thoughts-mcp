---
name: tree-of-thoughts
description: Multi-path investigation with parallel agents
---

# Tree of Thoughts

## CRITICAL: Protocol Completion is MANDATORY

**You MUST complete the FULL protocol. Presenting results without calling `tot_end` is FORBIDDEN.**

- You MUST reach Round 5 minimum
- You MUST have FOUND nodes at R4+ with VERIFY children
- You MUST call `tot_end` to finalize - NO exceptions
- Stopping early and writing your own summary is PROTOCOL VIOLATION

## CRITICAL: Agent Spawning is MANDATORY

**You MUST spawn a Task agent for EVERY proposed node.** The MCP tracks timing and agentId.

- Commits within 10 seconds of propose trigger SUSPICIOUS warnings
- Missing agentId triggers MISSING_AGENT warnings
- Fabricating findings without research is PROHIBITED

## Workflow (Single Root Paradigm)

```
1. tot_start → get sessionId
2. tot_propose → declare single root R1.A
3. **SPAWN Task agent for R1.A** ← REQUIRED
4. tot_commit → submit findings as EXPLORE
5. tot_propose → branch into 3-5 children at R2
6. Repeat spawning agents and committing
7. At R4+ you can use FOUND state
8. Add VERIFY child for each FOUND
9. Continue until R5+ and canEnd=true
10. tot_end → get final results with references
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
Round 1: R1.A (single root, parent: null)
Round 2: R2.A1, R2.A2, R2.A3 (branch wide from R1.A)
Round 3: R3.A1a, R3.A1b (parent: R2.A1)
Round 4: R4.A1a1 (parent: R3.A1a) - can use FOUND here
Round 5: R5.A1a1a (parent: R4.A1a1) - VERIFY node
```

## Rules

1. **Single root R1.A** - then branch wide at R2
2. **Cannot end before round 5** - forces thorough investigation
3. **EXPLORE nodes need 2+ children**
4. **FOUND only at Round 4+** - Earlier rounds auto-convert to EXPLORE
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

// Round 1: Single root
tot_propose({ sessionId, nodes: [
  { id: "R1.A", parent: null, title: "Main query", plannedAction: "Analyze problem" }
]})
tot_commit({ sessionId, results: [
  { nodeId: "R1.A", state: "EXPLORE", findings: "...", agentId: "abc-123" }
]})

// Round 2: Branch wide
tot_propose({ sessionId, nodes: [
  { id: "R2.A1", parent: "R1.A", title: "Path 1", plannedAction: "..." },
  { id: "R2.A2", parent: "R1.A", title: "Path 2", plannedAction: "..." },
  { id: "R2.A3", parent: "R1.A", title: "Path 3", plannedAction: "..." }
]})

// Continue through R3, R4...

// Round 4+: Can use FOUND
tot_commit({ sessionId, results: [
  { nodeId: "R4.A1a1", state: "FOUND", findings: "Solution found...", agentId: "..." }
]})

// Round 5: VERIFY the FOUND
tot_propose({ sessionId, nodes: [
  { id: "R5.A1a1a", parent: "R4.A1a1", title: "Verify solution", plannedAction: "Confirm findings" }
]})
tot_commit({ sessionId, results: [
  { nodeId: "R5.A1a1a", state: "VERIFY", findings: "Confirmed: ...", agentId: "..." }
]})

// Now canEnd=true
tot_end({ sessionId })
```

## Errors

| Error           | Fix                                            |
| --------------- | ---------------------------------------------- |
| NOT_PROPOSED    | Call tot_propose first                         |
| TERMINAL_PARENT | Use tot_reclassify to change parent to EXPLORE |

## Warnings (Anti-Gaming)

| Warning        | Meaning                                             |
| -------------- | --------------------------------------------------- |
| SUSPICIOUS     | Commit too fast after propose - no real research    |
| MISSING_AGENT  | No agentId provided - cannot verify research        |
| DEPTH_ENFORCED | FOUND before R4 converted to EXPLORE - add children |

## CRITICAL: EXPLORE Nodes Need 2+ Children

**Every EXPLORE node MUST have at least 2 children.** This is ENFORCED:

- `tot_commit` will warn: `🚨 CRITICAL [INCOMPLETE_EXPLORE]`
- `tot_end` will REJECT with: `BLOCKED: X EXPLORE nodes need more children`

If you create an EXPLORE node, you MUST branch it before moving on. No exceptions.
