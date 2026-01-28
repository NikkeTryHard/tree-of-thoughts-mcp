# Tree of Thoughts MCP Server - Usage Guide

## Node ID Format (CRITICAL)

**Format:** `R[round].[suffix]`

| Round | Parent | Child ID Examples |
|-------|--------|-------------------|
| 1 | null | R1.A, R1.B, R1.C, R1.D, R1.E |
| 2 | R1.A | R2.A1, R2.A2 |
| 2 | R1.B | R2.B1, R2.B2 |
| 3 | R2.A1 | R3.A1a, R3.A1b |

**WRONG:** `R1.A.1`, `R1.A.child`, `R2-A1`
**RIGHT:** `R2.A1`, `R3.A1a`, `R3.B2x`

## Required Workflow

```
1. tot_start    → Get sessionId
2. tot_propose  → Validate nodes (stores them)
3. tot_commit   → Submit results (uses stored proposals)
4. Repeat 2-3 until all nodes terminal or resolved
5. tot_end      → ONLY after Round 3+
```

## State Taxonomy

| State | Meaning | Children Required |
|-------|---------|-------------------|
| DRILL | Lead found | >= 2 |
| VERIFY | Ambiguous | >= 1 |
| DEAD | Dead end | 0 (terminal) |
| VALID | Solution | 0 (terminal) |
| SPEC | Theory | 0 (terminal) |

## Enforcement Rules

1. **Max 5 nodes per batch** - Split larger batches
2. **Minimum 3 rounds** - Cannot end before Round 3
3. **RECOVERY_REQUIRED** - If all nodes terminal before Round 3, spawn new lateral roots
4. **Two-phase commit** - Must propose before commit (NOT_PROPOSED error otherwise)
5. **Parent must exist** - Cannot reference uncommitted parents

## Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| INVALID_ID_FORMAT | Wrong node ID format | Use R[round].[suffix] |
| NOT_PROPOSED | Committed without proposing | Call tot_propose first |
| PARENT_NOT_FOUND | Parent not committed | Commit parent nodes first |
| TERMINAL_PARENT | Parent is DEAD/VALID/SPEC | Use tot_reclassify to revive |
| INSUFFICIENT_ROOTS | Not enough Round 1 nodes | Add more root nodes |
| BATCH_OVERFLOW | >5 nodes in batch | Split into multiple batches |

## Example Session

```javascript
// Round 1: Start with 5 roots
tot_start({ query: "...", minRoots: 5 })
tot_propose({ sessionId, nodes: [
  { id: "R1.A", parent: null, title: "...", plannedAction: "..." },
  { id: "R1.B", parent: null, title: "...", plannedAction: "..." },
  { id: "R1.C", parent: null, title: "...", plannedAction: "..." },
  { id: "R1.D", parent: null, title: "...", plannedAction: "..." },
  { id: "R1.E", parent: null, title: "...", plannedAction: "..." }
]})
tot_commit({ sessionId, results: [
  { nodeId: "R1.A", state: "DRILL", findings: "..." },
  { nodeId: "R1.B", state: "DEAD", findings: "..." },
  // ...
]})

// Round 2: Spawn children from DRILL/VERIFY nodes
tot_propose({ sessionId, nodes: [
  { id: "R2.A1", parent: "R1.A", title: "...", plannedAction: "..." },
  { id: "R2.A2", parent: "R1.A", title: "...", plannedAction: "..." }
]})
tot_commit({ ... })

// Round 3: Continue until all resolved
// ...

// End only after Round 3
tot_end({ sessionId })
```

## Recovery from All-Terminal Before Round 3

If all nodes become terminal before Round 3:
1. Server returns RECOVERY_REQUIRED
2. Spawn new lateral roots: `R1.F`, `R1.G`, etc.
3. Continue investigation from new angles
