# Development Guide

## Architecture

```
src/
├── index.ts          # MCP server entry, tool registration
├── types.ts          # NodeState enum, interfaces
├── state/
│   ├── investigation.ts  # Session persistence
│   ├── validation.ts     # Rule enforcement
│   └── dot-generator.ts  # Graph visualization
└── tools/
    ├── start.ts      # tot_start handler (single root)
    ├── propose.ts    # tot_propose handler
    ├── commit.ts     # tot_commit handler (depth enforcement R4+)
    ├── reclassify.ts # tot_reclassify handler
    ├── status.ts     # tot_status handler
    └── end.ts        # tot_end handler (reference extraction)
```

## State Machine

| State   | Terminal | Children | Color   |
|---------|----------|----------|---------|
| EXPLORE | No       | 2+       | lightblue |
| FOUND   | No       | 1+ VERIFY| orange  |
| VERIFY  | Yes      | 0        | green   |
| DEAD    | Yes      | 0        | red     |

## Key Files

- `types.ts` - `isTerminalState()` and `getRequiredChildren()` define state behavior
- `commit.ts` - Depth enforcement (FOUND->EXPLORE before R4), timing warnings
- `validation.ts` - `canEndInvestigation()` checks all rules (min 5 rounds)
- `end.ts` - `extractReferences()` parses URLs/paths from findings

## Testing

```bash
npm test              # Run all tests
npm run build         # Build to dist/
```

## Adding New Rules

1. Add validation logic to `src/state/validation.ts`
2. Update `canEndInvestigation()` if it affects ending
3. Add tests to verify behavior
4. Update SKILL.md and README if user-facing

## Anti-Gaming Measures

- `proposedAt` timestamp stored on propose
- `MIN_RESEARCH_TIME_MS` check on commit (10s)
- `agentId` tracking for audit trail
- Warnings returned in commit response

## Single Root Paradigm

- Always start with single root R1.A
- Branch into 3-5 children at R2
- FOUND only allowed at R4+
- Minimum 5 rounds before ending
