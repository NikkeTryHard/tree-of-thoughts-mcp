# Tree of Thoughts MCP Server v2.0

## States (4 states)

| State   | Meaning              | Children | Terminal |
| ------- | -------------------- | -------- | -------- |
| EXPLORE | Dig deeper           | 2+       | No       |
| FOUND   | Provisional solution | 1+ VERIFY| No       |
| VERIFY  | Confirms FOUND       | 0        | Yes      |
| DEAD    | Dead end             | 0        | Yes      |

## Workflow

```
1. tot_start    → get sessionId
2. tot_propose  → declare nodes (max 5)
3. Spawn Task agents for EACH node
4. tot_commit   → submit results with agentId
5. Repeat 2-4 until canEnd=true
6. tot_end      → finalize with references
```

## Node IDs

Format: `R[round].[suffix]`

- Round 1: R1.A, R1.B, R1.C (parent: null)
- Round 2: R2.A1, R2.A2 (parent: R1.A)
- Round 3: R3.A1a (parent: R2.A1) - can use FOUND here
- Round 4: R4.A1a1 (parent: R3.A1a) - VERIFY node

## Rules

1. Max 5 nodes per batch
2. Cannot end before round 3
3. EXPLORE nodes need 2+ children
4. FOUND only at R3+ (auto-converts to EXPLORE before)
5. FOUND needs 1+ VERIFY children

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

// Spawn Task agents, then commit with agentId
tot_commit({
  sessionId,
  results: [
    { nodeId: "R1.A", state: "EXPLORE", findings: "...", agentId: "abc-123" },
    { nodeId: "R1.B", state: "DEAD", findings: "...", agentId: "def-456" },
  ],
});

// At R3+: use FOUND, then add VERIFY child
tot_commit({
  sessionId,
  results: [
    { nodeId: "R3.A1a", state: "FOUND", findings: "...", agentId: "..." },
  ],
});

tot_propose({
  sessionId,
  nodes: [{ id: "R4.A1a1", parent: "R3.A1a", title: "Verify", plannedAction: "Confirm" }],
});

tot_commit({
  sessionId,
  results: [{ nodeId: "R4.A1a1", state: "VERIFY", findings: "Confirmed", agentId: "..." }],
});

// Now canEnd=true
tot_end({ sessionId });
```
