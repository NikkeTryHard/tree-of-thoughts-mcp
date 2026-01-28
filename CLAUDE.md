# Tree of Thoughts MCP Server v2.0

## States (only 3)

| State   | Meaning    | Children Required |
| ------- | ---------- | ----------------- |
| EXPLORE | Dig deeper | 2+                |
| DEAD    | Dead end   | 0                 |
| FOUND   | Solution   | 0                 |

## Workflow

```
1. tot_start    → get sessionId
2. tot_propose  → declare nodes (max 5)
3. tot_commit   → submit results
4. Repeat until canEnd=true
5. tot_end      → finalize
```

## Node IDs

Format: `R[round].[suffix]`

- Round 1: R1.A, R1.B, R1.C (parent: null)
- Round 2: R2.A1, R2.A2 (parent: R1.A)
- Round 3: R3.A1a (parent: R2.A1)

## Rules

1. Max 5 nodes per batch
2. Cannot end before round 3
3. All EXPLORE nodes need 2+ children

## Example

```javascript
tot_start({ query: "..." });

tot_propose({
  sessionId,
  nodes: [
    { id: "R1.A", parent: null, title: "...", plannedAction: "..." },
    { id: "R1.B", parent: null, title: "...", plannedAction: "..." },
  ],
});

tot_commit({
  sessionId,
  results: [
    { nodeId: "R1.A", state: "EXPLORE", findings: "..." },
    { nodeId: "R1.B", state: "DEAD", findings: "..." },
  ],
});

// Continue until canEnd=true, then:
tot_end({ sessionId });
```
