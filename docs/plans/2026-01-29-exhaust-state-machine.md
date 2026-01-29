# EXHAUST State Machine Implementation Plan

> **REQUIRED:** Use `execute-plan` to implement this plan batch by batch.

**Goal:** Add EXHAUST intermediate state and enforce stricter round requirements for DEAD/FOUND states.

**Architecture:** Extend NodeState enum with EXHAUST, update state validation functions, modify commit.ts depth enforcement to auto-convert states based on round, update FOUND to require 2+ VERIFY children.

**Tech Stack:** TypeScript, Bun test runner

---

## New State Machine Reference

| State | Meaning | Children Required | Terminal | Min Round |
|-------|---------|------------------|----------|-----------|
| EXPLORE | Dig deeper | 2+ any | No | R1 |
| FOUND | Provisional solution | 2+ VERIFY | No | R4 |
| VERIFY | Confirms FOUND | 0 | Yes | R5 |
| EXHAUST | Exhausted path | 1+ DEAD | No | R3 |
| DEAD | Confirmed dead end | 0 | Yes | R4 |

## Auto-Conversion Rules

| Attempt | At Round | Converts To |
|---------|----------|-------------|
| EXHAUST | R1-R2 | EXPLORE |
| DEAD | R1-R2 | EXPLORE |
| DEAD | R3 | EXHAUST |
| FOUND | R1-R3 | EXPLORE |

---

### Batch 1: Add EXHAUST State and Update Type Functions

**Goal:** Add EXHAUST to the state enum and update all state-related functions.

#### Task 1.1: Add EXHAUST to NodeState enum and STATE_COLORS

**Files:**
- Modify: `src/types.ts:1-28`
- Test: `src/types.test.ts`

**Step 1: Write failing test**

Add to `src/types.test.ts`:

```typescript
describe("EXHAUST state", () => {
  it("EXHAUST is not terminal", () => {
    expect(isTerminalState(NodeState.EXHAUST)).toBe(false);
  });

  it("EXHAUST requires 1 child (DEAD)", () => {
    expect(getRequiredChildren(NodeState.EXHAUST)).toBe(1);
  });
});
```

**Step 2: Verify failure**

Run: `cd /home/nikketryhard/tree-of-thoughts-mcp && bun test src/types.test.ts`

Expected: FAIL with "Property 'EXHAUST' does not exist"

**Step 3: Implement**

Update `src/types.ts`:

```typescript
export enum NodeState {
  EXPLORE = "EXPLORE", // Needs 2+ children to investigate further
  DEAD = "DEAD", // Confirmed dead end, terminal (requires EXHAUST parent)
  FOUND = "FOUND", // Provisional solution, needs 2+ VERIFY children
  VERIFY = "VERIFY", // Confirms parent FOUND node
  EXHAUST = "EXHAUST", // Exhausted path, needs 1+ DEAD children
}

export const STATE_COLORS: Record<NodeState, string> = {
  [NodeState.EXPLORE]: "lightblue",
  [NodeState.DEAD]: "red",
  [NodeState.FOUND]: "orange",
  [NodeState.VERIFY]: "green",
  [NodeState.EXHAUST]: "gray",
};

export function isTerminalState(state: NodeState): boolean {
  return state === NodeState.DEAD || state === NodeState.VERIFY;
}

export function getRequiredChildren(state: NodeState): number {
  switch (state) {
    case NodeState.EXPLORE:
      return 2;
    case NodeState.FOUND:
      return 2; // Changed from 1 to 2 VERIFY children
    case NodeState.EXHAUST:
      return 1; // Needs 1+ DEAD children
    default:
      return 0;
  }
}
```

**Step 4: Verify pass**

Run: `cd /home/nikketryhard/tree-of-thoughts-mcp && bun test src/types.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /home/nikketryhard/tree-of-thoughts-mcp
git add src/types.ts src/types.test.ts
git commit -m "feat: add EXHAUST state to NodeState enum"
```

---

#### Task 1.2: Update FOUND to require 2+ VERIFY children

**Files:**
- Modify: `src/types.ts` (already done in 1.1)
- Test: `src/types.test.ts`

**Step 1: Write failing test**

Update existing test in `src/types.test.ts`:

```typescript
describe("VERIFY state", () => {
  // ... existing tests ...

  it("FOUND requires 2 children", () => {
    expect(getRequiredChildren(NodeState.FOUND)).toBe(2);
  });
});
```

**Step 2: Verify failure**

Run: `cd /home/nikketryhard/tree-of-thoughts-mcp && bun test src/types.test.ts`

Expected: FAIL - "Expected: 2, Received: 1" (if not already updated)

**Step 3: Implement**

Already implemented in Task 1.1 - `getRequiredChildren(NodeState.FOUND)` returns 2.

**Step 4: Verify pass**

Run: `cd /home/nikketryhard/tree-of-thoughts-mcp && bun test src/types.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /home/nikketryhard/tree-of-thoughts-mcp
git add src/types.test.ts
git commit -m "test: verify FOUND requires 2+ VERIFY children"
```

---

### Batch 2: Implement Round-Based State Enforcement in Commit

**Goal:** Add auto-conversion logic for EXHAUST and DEAD based on round.

#### Task 2.1: Add round constants and conversion logic

**Files:**
- Modify: `src/tools/commit.ts:127-138`
- Test: `src/tools/commit.test.ts`

**Step 1: Write failing tests**

Add to `src/tools/commit.test.ts`:

```typescript
describe("EXHAUST state enforcement", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("converts EXHAUST to EXPLORE at R2", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "Root", plannedAction: "test" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "a000001" }] }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "Child1", plannedAction: "test" },
        { id: "R2.A2", parent: "R1.A", title: "Child2", plannedAction: "test" },
      ],
    }, TEST_DIR);

    const result = await handleCommit({
      sessionId,
      results: [
        { nodeId: "R2.A1", state: NodeState.EXHAUST, findings: "exhausted", agentId: "a000002" },
        { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "a000003" },
      ],
    }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.warnings.some((w) => w.includes("EXHAUST_ENFORCED"))).toBe(true);
    expect(result.pendingExplore).toContain("R2.A1");
  });

  it("allows EXHAUST at R3", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Build to R3
    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "b000001" }] }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "R2a", plannedAction: "t" },
        { id: "R2.A2", parent: "R1.A", title: "R2b", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "b000002" },
        { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "b000003" },
      ],
    }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R3.A1a", parent: "R2.A1", title: "R3a", plannedAction: "t" },
        { id: "R3.A1b", parent: "R2.A1", title: "R3b", plannedAction: "t" },
        { id: "R3.A2a", parent: "R2.A2", title: "R3c", plannedAction: "t" },
        { id: "R3.A2b", parent: "R2.A2", title: "R3d", plannedAction: "t" },
      ],
    }, TEST_DIR);

    const result = await handleCommit({
      sessionId,
      results: [
        { nodeId: "R3.A1a", state: NodeState.EXHAUST, findings: "exhausted", agentId: "b000004" },
        { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "x", agentId: "b000005" },
        { nodeId: "R3.A2a", state: NodeState.EXPLORE, findings: "x", agentId: "b000006" },
        { nodeId: "R3.A2b", state: NodeState.EXPLORE, findings: "x", agentId: "b000007" },
      ],
    }, TEST_DIR);

    expect(result.warnings.some((w) => w.includes("EXHAUST_ENFORCED"))).toBe(false);
  });
});

describe("DEAD state enforcement", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("converts DEAD to EXPLORE at R2", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "Root", plannedAction: "test" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "c000001" }] }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "Child1", plannedAction: "test" },
        { id: "R2.A2", parent: "R1.A", title: "Child2", plannedAction: "test" },
      ],
    }, TEST_DIR);

    const result = await handleCommit({
      sessionId,
      results: [
        { nodeId: "R2.A1", state: NodeState.DEAD, findings: "dead", agentId: "c000002" },
        { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "c000003" },
      ],
    }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.warnings.some((w) => w.includes("DEAD_ENFORCED"))).toBe(true);
    expect(result.pendingExplore).toContain("R2.A1");
  });

  it("converts DEAD to EXHAUST at R3", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Build to R3
    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "d000001" }] }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "R2a", plannedAction: "t" },
        { id: "R2.A2", parent: "R1.A", title: "R2b", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "d000002" },
        { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "d000003" },
      ],
    }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R3.A1a", parent: "R2.A1", title: "R3a", plannedAction: "t" },
        { id: "R3.A1b", parent: "R2.A1", title: "R3b", plannedAction: "t" },
        { id: "R3.A2a", parent: "R2.A2", title: "R3c", plannedAction: "t" },
        { id: "R3.A2b", parent: "R2.A2", title: "R3d", plannedAction: "t" },
      ],
    }, TEST_DIR);

    const result = await handleCommit({
      sessionId,
      results: [
        { nodeId: "R3.A1a", state: NodeState.DEAD, findings: "dead", agentId: "d000004" },
        { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "x", agentId: "d000005" },
        { nodeId: "R3.A2a", state: NodeState.EXPLORE, findings: "x", agentId: "d000006" },
        { nodeId: "R3.A2b", state: NodeState.EXPLORE, findings: "x", agentId: "d000007" },
      ],
    }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.warnings.some((w) => w.includes("DEAD_ENFORCED") && w.includes("EXHAUST"))).toBe(true);
    expect(result.pendingExplore).toContain("R3.A1a"); // EXHAUST needs children too
  });

  it("allows DEAD at R4", async () => {
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Build to R4
    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.EXPLORE, findings: "x", agentId: "e000001" }] }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R2.A1", parent: "R1.A", title: "R2a", plannedAction: "t" },
        { id: "R2.A2", parent: "R1.A", title: "R2b", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x", agentId: "e000002" },
        { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "e000003" },
      ],
    }, TEST_DIR);

    await handlePropose({
      sessionId,
      nodes: [
        { id: "R3.A1a", parent: "R2.A1", title: "R3a", plannedAction: "t" },
        { id: "R3.A1b", parent: "R2.A1", title: "R3b", plannedAction: "t" },
        { id: "R3.A2a", parent: "R2.A2", title: "R3c", plannedAction: "t" },
        { id: "R3.A2b", parent: "R2.A2", title: "R3d", plannedAction: "t" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R3.A1a", state: NodeState.EXHAUST, findings: "exhausted", agentId: "e000004" },
        { nodeId: "R3.A1b", state: NodeState.EXPLORE, findings: "x", agentId: "e000005" },
        { nodeId: "R3.A2a", state: NodeState.EXPLORE, findings: "x", agentId: "e000006" },
        { nodeId: "R3.A2b", state: NodeState.EXPLORE, findings: "x", agentId: "e000007" },
      ],
    }, TEST_DIR);

    // R4 - DEAD should be allowed as child of EXHAUST
    await handlePropose({
      sessionId,
      nodes: [{ id: "R4.A1a1", parent: "R3.A1a", title: "R4a", plannedAction: "t" }],
    }, TEST_DIR);

    const result = await handleCommit({
      sessionId,
      results: [{ nodeId: "R4.A1a1", state: NodeState.DEAD, findings: "confirmed dead", agentId: "e000008" }],
    }, TEST_DIR);

    expect(result.warnings.some((w) => w.includes("DEAD_ENFORCED"))).toBe(false);
  });
});
```

**Step 2: Verify failure**

Run: `cd /home/nikketryhard/tree-of-thoughts-mcp && bun test src/tools/commit.test.ts`

Expected: FAIL - tests reference NodeState.EXHAUST which doesn't exist yet, or conversion logic missing

**Step 3: Implement**

Update `src/tools/commit.ts` - replace the depth enforcement section (around line 127-138):

```typescript
// Depth enforcement constants
const MIN_ROUND_FOR_FOUND = 4;
const MIN_ROUND_FOR_EXHAUST = 3;
const MIN_ROUND_FOR_DEAD = 4;

// Depth enforcement: state conversions based on round
const processedResults = input.results.map((result) => {
  const roundMatch = result.nodeId.match(/^R(\d+)\./);
  const round = roundMatch ? parseInt(roundMatch[1], 10) : 1;

  // FOUND only allowed at R4+
  if (result.state === NodeState.FOUND && round < MIN_ROUND_FOR_FOUND) {
    warnings.push(`⚠️ WARNING [DEPTH_ENFORCED]: ${result.nodeId} converted FOUND→EXPLORE (round ${round} < ${MIN_ROUND_FOR_FOUND}). You MUST add 2+ children before proceeding.`);
    return { ...result, state: NodeState.EXPLORE };
  }

  // EXHAUST only allowed at R3+
  if (result.state === NodeState.EXHAUST && round < MIN_ROUND_FOR_EXHAUST) {
    warnings.push(`⚠️ WARNING [EXHAUST_ENFORCED]: ${result.nodeId} converted EXHAUST→EXPLORE (round ${round} < ${MIN_ROUND_FOR_EXHAUST}). You MUST add 2+ children before proceeding.`);
    return { ...result, state: NodeState.EXPLORE };
  }

  // DEAD only allowed at R4+
  if (result.state === NodeState.DEAD && round < MIN_ROUND_FOR_DEAD) {
    if (round < MIN_ROUND_FOR_EXHAUST) {
      // R1-R2: Convert to EXPLORE
      warnings.push(`⚠️ WARNING [DEAD_ENFORCED]: ${result.nodeId} converted DEAD→EXPLORE (round ${round} < ${MIN_ROUND_FOR_EXHAUST}). You MUST add 2+ children before proceeding.`);
      return { ...result, state: NodeState.EXPLORE };
    } else {
      // R3: Convert to EXHAUST
      warnings.push(`⚠️ WARNING [DEAD_ENFORCED]: ${result.nodeId} converted DEAD→EXHAUST (round ${round} < ${MIN_ROUND_FOR_DEAD}). You MUST add 1+ DEAD child to confirm.`);
      return { ...result, state: NodeState.EXHAUST };
    }
  }

  return result;
});
```

**Step 4: Verify pass**

Run: `cd /home/nikketryhard/tree-of-thoughts-mcp && bun test src/tools/commit.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /home/nikketryhard/tree-of-thoughts-mcp
git add src/tools/commit.ts src/tools/commit.test.ts
git commit -m "feat: add round-based state enforcement for EXHAUST and DEAD"
```

---

### Batch 3: Update Validation and Integration Tests

**Goal:** Update validation logic and fix integration tests for new state machine.

#### Task 3.1: Update getIncompleteExploreNodes to handle EXHAUST

**Files:**
- Modify: `src/state/validation.ts`
- Test: `src/state/validation.test.ts`

**Step 1: Write failing test**

Add to `src/state/validation.test.ts`:

```typescript
describe("getIncompleteExploreNodes with EXHAUST", () => {
  it("returns EXHAUST nodes with 0 children", () => {
    const state = InvestigationState.create("test", 1, TEST_DIR);
    state.addNode({ id: "R1.A", parent: null, state: NodeState.EXPLORE, title: "Root", findings: null, children: ["R2.A1", "R2.A2"], round: 1 });
    state.addNode({ id: "R2.A1", parent: "R1.A", state: NodeState.EXHAUST, title: "Exhausted", findings: null, children: [], round: 2 });
    state.addNode({ id: "R2.A2", parent: "R1.A", state: NodeState.EXPLORE, title: "Continue", findings: null, children: ["R3.A2a", "R3.A2b"], round: 2 });
    state.addNode({ id: "R3.A2a", parent: "R2.A2", state: NodeState.DEAD, title: "Dead", findings: null, children: [], round: 3 });
    state.addNode({ id: "R3.A2b", parent: "R2.A2", state: NodeState.DEAD, title: "Dead", findings: null, children: [], round: 3 });

    const incomplete = getIncompleteExploreNodes(state);
    expect(incomplete.some((n) => n.nodeId === "R2.A1")).toBe(true);
    expect(incomplete.find((n) => n.nodeId === "R2.A1")?.needs).toBe(1);
  });

  it("does not return EXHAUST nodes with 1+ DEAD children", () => {
    const state = InvestigationState.create("test", 1, TEST_DIR);
    state.addNode({ id: "R1.A", parent: null, state: NodeState.EXPLORE, title: "Root", findings: null, children: ["R2.A1", "R2.A2"], round: 1 });
    state.addNode({ id: "R2.A1", parent: "R1.A", state: NodeState.EXHAUST, title: "Exhausted", findings: null, children: ["R3.A1a"], round: 2 });
    state.addNode({ id: "R2.A2", parent: "R1.A", state: NodeState.EXPLORE, title: "Continue", findings: null, children: ["R3.A2a", "R3.A2b"], round: 2 });
    state.addNode({ id: "R3.A1a", parent: "R2.A1", state: NodeState.DEAD, title: "Confirmed Dead", findings: null, children: [], round: 3 });
    state.addNode({ id: "R3.A2a", parent: "R2.A2", state: NodeState.DEAD, title: "Dead", findings: null, children: [], round: 3 });
    state.addNode({ id: "R3.A2b", parent: "R2.A2", state: NodeState.DEAD, title: "Dead", findings: null, children: [], round: 3 });

    const incomplete = getIncompleteExploreNodes(state);
    expect(incomplete.some((n) => n.nodeId === "R2.A1")).toBe(false);
  });
});
```

**Step 2: Verify failure**

Run: `cd /home/nikketryhard/tree-of-thoughts-mcp && bun test src/state/validation.test.ts`

Expected: FAIL - EXHAUST not handled or NodeState.EXHAUST doesn't exist

**Step 3: Implement**

The `getIncompleteExploreNodes` function should already work if it uses `isTerminalState` and `getRequiredChildren` correctly. Verify the implementation in `src/state/validation.ts` handles all non-terminal states.

**Step 4: Verify pass**

Run: `cd /home/nikketryhard/tree-of-thoughts-mcp && bun test src/state/validation.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /home/nikketryhard/tree-of-thoughts-mcp
git add src/state/validation.ts src/state/validation.test.ts
git commit -m "feat: update validation to handle EXHAUST state"
```

---

#### Task 3.2: Update integration tests for new state requirements

**Files:**
- Modify: `src/integration.test.ts`

**Step 1: Update existing integration tests**

The existing tests use DEAD states at early rounds. Update them to use the new state machine:

1. Replace early DEAD with EXPLORE or EXHAUST→DEAD chain
2. Update FOUND to have 2 VERIFY children
3. Ensure DEAD only appears at R4+

**Step 2: Verify all tests pass**

Run: `cd /home/nikketryhard/tree-of-thoughts-mcp && bun test`

Expected: All tests PASS

**Step 3: Commit**

```bash
cd /home/nikketryhard/tree-of-thoughts-mcp
git add src/integration.test.ts
git commit -m "test: update integration tests for new state machine"
```

---

### Batch 4: Update SKILL.md and Documentation

**Goal:** Update skill documentation with new state machine.

#### Task 4.1: Update SKILL.md with EXHAUST state

**Files:**
- Modify: `tree-of-thoughts/SKILL.md`

**Step 1: Update the States table**

```markdown
## States (5 states)

| State   | Meaning              | Children   | Min Round | Terminal |
| ------- | -------------------- | ---------- | --------- | -------- |
| EXPLORE | Dig deeper           | 2+ any     | R1        | No       |
| EXHAUST | Exhausted path       | 1+ DEAD    | R3        | No       |
| DEAD    | Confirmed dead end   | 0          | R4        | Yes      |
| FOUND   | Provisional solution | 2+ VERIFY  | R4        | No       |
| VERIFY  | Confirms FOUND       | 0          | R5        | Yes      |

**Key rules:**
- EXHAUST at R1-R2 → auto-converted to EXPLORE
- DEAD at R1-R2 → auto-converted to EXPLORE
- DEAD at R3 → auto-converted to EXHAUST
- FOUND at R1-R3 → auto-converted to EXPLORE
- Every FOUND needs 2 independent VERIFY children
- Every EXHAUST needs at least 1 DEAD child to confirm
```

**Step 2: Sync to local skills**

```bash
cp /home/nikketryhard/tree-of-thoughts-mcp/tree-of-thoughts/SKILL.md ~/.claude/skills/tree-of-thoughts/SKILL.md
```

**Step 3: Commit**

```bash
cd /home/nikketryhard/tree-of-thoughts-mcp
git add tree-of-thoughts/SKILL.md
git commit -m "docs: update SKILL.md with EXHAUST state and new requirements"
```

---

### Batch 5: Build and Final Verification

**Goal:** Build project and verify all tests pass.

#### Task 5.1: Run full test suite

**Step 1: Run all tests**

```bash
cd /home/nikketryhard/tree-of-thoughts-mcp && bun test
```

Expected: All tests PASS

#### Task 5.2: Build project

**Step 1: Build**

```bash
cd /home/nikketryhard/tree-of-thoughts-mcp && bun run build
```

Expected: Build succeeds

#### Task 5.3: Final commit

```bash
cd /home/nikketryhard/tree-of-thoughts-mcp
git add -A
git commit -m "feat: complete EXHAUST state machine implementation"
```
