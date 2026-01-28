# Multi-Gate Validation System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan batch by batch.

**Goal:** Prevent AI gaming by implementing a 6-layer validation system that enforces deep exploration before allowing investigation termination.

**Architecture:** Expand NodeState enum with pending states (VALID_PENDING), add terminal ratio tracking, implement quality score calculation, add evidence requirements, enforce state pipelines, and gate tot_end on composite quality threshold.

**Tech Stack:** TypeScript, Bun, Zod, MCP SDK

---

## Batch 1: Extended State System + Evidence Requirements

**Goal:** Add VALID_PENDING state, evidence fields to commit schema, and update type definitions.

### Task 1.1: Extend NodeState Enum

**Files:**
- Modify: `src/types.ts:1-30`
- Test: `src/types.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/types.test.ts
import { NodeState, isTerminalState, isPendingState, getRequiredChildren } from "./types";

test("VALID_PENDING is not terminal", () => {
  expect(isTerminalState(NodeState.VALID_PENDING)).toBe(false);
});

test("VALID_PENDING requires 1 confirmation child", () => {
  expect(getRequiredChildren(NodeState.VALID_PENDING)).toBe(1);
});

test("isPendingState identifies pending states", () => {
  expect(isPendingState(NodeState.VALID_PENDING)).toBe(true);
  expect(isPendingState(NodeState.VALID)).toBe(false);
  expect(isPendingState(NodeState.DRILL)).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/types.test.ts`
Expected: FAIL - NodeState.VALID_PENDING not defined

**Step 3: Write minimal implementation**

```typescript
// src/types.ts - Update enum and helpers
export enum NodeState {
  DRILL = "DRILL",
  VERIFY = "VERIFY",
  DEAD = "DEAD",
  VALID = "VALID",
  VALID_PENDING = "VALID_PENDING",
  SPEC = "SPEC",
}

export const STATE_COLORS: Record<NodeState, string> = {
  [NodeState.DRILL]: "lightblue",
  [NodeState.VERIFY]: "purple",
  [NodeState.DEAD]: "red",
  [NodeState.VALID]: "green",
  [NodeState.VALID_PENDING]: "lightgreen",
  [NodeState.SPEC]: "gold",
};

export function isTerminalState(state: NodeState): boolean {
  return [NodeState.DEAD, NodeState.VALID, NodeState.SPEC].includes(state);
}

export function isPendingState(state: NodeState): boolean {
  return state === NodeState.VALID_PENDING;
}

export function getRequiredChildren(state: NodeState): number {
  switch (state) {
    case NodeState.DRILL:
      return 3; // Increased from 2 to force more exploration
    case NodeState.VERIFY:
      return 1;
    case NodeState.VALID_PENDING:
      return 1; // Needs confirmation child
    default:
      return 0;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/types.test.ts
git commit -m "feat: add VALID_PENDING state and isPendingState helper"
```

### Task 1.2: Add Evidence Fields to ToTNode

**Files:**
- Modify: `src/types.ts:32-40`
- Test: `src/types.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/types.test.ts
test("ToTNode has evidence fields", () => {
  const node: ToTNode = {
    id: "R1.A",
    parent: null,
    state: NodeState.VALID,
    title: "Test",
    findings: "Found something",
    children: [],
    round: 1,
    evidence: "Detailed evidence here",
    verificationMethod: "Manual testing",
    alternativesConsidered: ["Option B", "Option C"],
  };
  expect(node.evidence).toBe("Detailed evidence here");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/types.test.ts`
Expected: FAIL - evidence property not in ToTNode

**Step 3: Write minimal implementation**

```typescript
// src/types.ts - Update ToTNode interface
export interface ToTNode {
  id: string;
  parent: string | null;
  state: NodeState;
  title: string;
  findings: string | null;
  children: string[];
  round: number;
  // Evidence fields for terminal states
  evidence?: string;
  verificationMethod?: string;
  alternativesConsidered?: string[];
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/types.test.ts
git commit -m "feat: add evidence fields to ToTNode interface"
```

### Task 1.3: Update Commit Schema for Evidence

**Files:**
- Modify: `src/tools/commit.ts:6-17`
- Test: `src/tools/commit.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/tools/commit.test.ts
test("rejects terminal state without evidence", async () => {
  await handlePropose(
    {
      sessionId,
      nodes: [
        { id: "R1.A", parent: null, title: "A", plannedAction: "A" },
        { id: "R1.B", parent: null, title: "B", plannedAction: "B" },
      ],
    },
    TEST_DIR
  );

  const result = await handleCommit(
    {
      sessionId,
      results: [
        { nodeId: "R1.A", state: NodeState.VALID, findings: "Found it" },
        { nodeId: "R1.B", state: NodeState.DEAD, findings: "Dead end" },
      ],
    },
    TEST_DIR
  );

  expect(result.status).toBe("REJECTED");
  expect(result.errors.some((e) => e.error === "MISSING_EVIDENCE")).toBe(true);
});

test("accepts terminal state with evidence", async () => {
  await handlePropose(
    {
      sessionId,
      nodes: [
        { id: "R1.A", parent: null, title: "A", plannedAction: "A" },
        { id: "R1.B", parent: null, title: "B", plannedAction: "B" },
      ],
    },
    TEST_DIR
  );

  const result = await handleCommit(
    {
      sessionId,
      results: [
        {
          nodeId: "R1.A",
          state: NodeState.DEAD,
          findings: "Dead end found",
          evidence: "Tested all combinations, none worked because X, Y, Z",
          verificationMethod: "Exhaustive testing",
          alternativesConsidered: ["Tried approach B", "Tried approach C"],
        },
        {
          nodeId: "R1.B",
          state: NodeState.DRILL,
          findings: "More to explore",
        },
      ],
    },
    TEST_DIR
  );

  expect(result.status).toBe("OK");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/tools/commit.test.ts`
Expected: FAIL - evidence field not in schema

**Step 3: Write minimal implementation**

```typescript
// src/tools/commit.ts - Update schema
export const commitInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  results: z
    .array(
      z.object({
        nodeId: z.string().describe("The node ID that was executed"),
        state: z.nativeEnum(NodeState).describe("The resulting state"),
        findings: z.string().describe("What the agent discovered"),
        evidence: z.string().min(50).optional().describe("Detailed evidence for terminal states (min 50 chars)"),
        verificationMethod: z.string().optional().describe("How this was verified"),
        alternativesConsidered: z.array(z.string()).optional().describe("Other approaches tried"),
      })
    )
    .describe("Results from executed agents"),
});
```

Then add validation in handleCommit after line 75:

```typescript
// Validate evidence for terminal states
for (const result of input.results) {
  if (isTerminalState(result.state) || result.state === NodeState.VALID_PENDING) {
    if (!result.evidence || result.evidence.length < 50) {
      errors.push({
        nodeId: result.nodeId,
        error: "MISSING_EVIDENCE",
        message: `Terminal state ${result.state} requires evidence field with minimum 50 characters`,
        suggestion: "Provide detailed evidence explaining why this conclusion was reached",
      });
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/tools/commit.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/commit.ts src/tools/commit.test.ts
git commit -m "feat: require evidence for terminal states in commit"
```

---

## Batch 2: Terminal Ratio Gates + Round-Based Restrictions

**Goal:** Implement terminal ratio validation per round and block VALID before round 3.

### Task 2.1: Add Terminal Ratio Validation

**Files:**
- Modify: `src/state/validation.ts`
- Test: `src/state/validation.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/state/validation.test.ts
describe("Terminal Ratio Validation", () => {
  test("rejects batch with >30% terminal in round 2", async () => {
    // Setup: Create investigation at round 2
    const state = InvestigationState.create("Test", 2, TEST_DIR);

    // Add round 1 nodes
    state.addNode({ id: "R1.A", parent: null, state: NodeState.DRILL, title: "A", findings: null, children: ["R2.A1", "R2.A2", "R2.A3"], round: 1 });
    state.addNode({ id: "R1.B", parent: null, state: NodeState.DRILL, title: "B", findings: null, children: [], round: 1 });
    state.data.currentRound = 2;

    // Propose 3 children - all terminal (100% > 30% limit)
    const proposed = [
      { id: "R2.A1", parent: "R1.A", title: "A1", plannedAction: "A1" },
      { id: "R2.A2", parent: "R1.A", title: "A2", plannedAction: "A2" },
      { id: "R2.A3", parent: "R1.A", title: "A3", plannedAction: "A3" },
    ];
    const results = [
      { nodeId: "R2.A1", state: NodeState.DEAD },
      { nodeId: "R2.A2", state: NodeState.VALID_PENDING },
      { nodeId: "R2.A3", state: NodeState.DEAD },
    ];

    const errors = Validator.validateTerminalRatio(state, results, 2);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe("TERMINAL_RATIO_EXCEEDED");
  });

  test("allows batch with <=30% terminal in round 2", async () => {
    const state = InvestigationState.create("Test", 2, TEST_DIR);
    state.data.currentRound = 2;

    const results = [
      { nodeId: "R2.A1", state: NodeState.DRILL },
      { nodeId: "R2.A2", state: NodeState.DRILL },
      { nodeId: "R2.A3", state: NodeState.DEAD }, // 33% but within tolerance
    ];

    const errors = Validator.validateTerminalRatio(state, results, 2);

    expect(errors.length).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/state/validation.test.ts`
Expected: FAIL - validateTerminalRatio not defined

**Step 3: Write minimal implementation**

```typescript
// Add to src/state/validation.ts
static validateTerminalRatio(
  state: InvestigationState,
  results: Array<{ nodeId: string; state: NodeState }>,
  round: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Terminal ratio limits by round
  const TERMINAL_LIMITS: Record<number, number> = {
    1: 0.0,   // 0% terminal allowed in round 1 (except DEAD)
    2: 0.35,  // 35% terminal allowed in round 2
    3: 0.50,  // 50% terminal allowed in round 3
    4: 0.70,  // 70% terminal allowed in round 4+
  };

  const limit = TERMINAL_LIMITS[round] ?? TERMINAL_LIMITS[4];

  const terminalCount = results.filter((r) =>
    isTerminalState(r.state) || isPendingState(r.state)
  ).length;

  const ratio = terminalCount / results.length;

  if (ratio > limit) {
    errors.push({
      nodeId: "BATCH",
      error: "TERMINAL_RATIO_EXCEEDED",
      message: `Round ${round} allows max ${Math.round(limit * 100)}% terminal states. Batch has ${Math.round(ratio * 100)}% (${terminalCount}/${results.length})`,
      suggestion: `Mark more nodes as DRILL or VERIFY to continue exploration`,
    });
  }

  return errors;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/state/validation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/state/validation.ts src/state/validation.test.ts
git commit -m "feat: add terminal ratio validation per round"
```

### Task 2.2: Block VALID/VALID_PENDING Before Round 3

**Files:**
- Modify: `src/state/validation.ts`
- Test: `src/state/validation.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/state/validation.test.ts
test("rejects VALID state before round 3", () => {
  const state = InvestigationState.create("Test", 2, TEST_DIR);
  state.data.currentRound = 2;

  const results = [{ nodeId: "R2.A1", state: NodeState.VALID }];
  const errors = Validator.validateStateAvailability(state, results);

  expect(errors.length).toBe(1);
  expect(errors[0].error).toBe("STATE_LOCKED");
});

test("rejects VALID_PENDING before round 3", () => {
  const state = InvestigationState.create("Test", 2, TEST_DIR);
  state.data.currentRound = 2;

  const results = [{ nodeId: "R2.A1", state: NodeState.VALID_PENDING }];
  const errors = Validator.validateStateAvailability(state, results);

  expect(errors.length).toBe(1);
  expect(errors[0].error).toBe("STATE_LOCKED");
});

test("allows VALID_PENDING at round 3+", () => {
  const state = InvestigationState.create("Test", 2, TEST_DIR);
  state.data.currentRound = 3;

  const results = [{ nodeId: "R3.A1", state: NodeState.VALID_PENDING }];
  const errors = Validator.validateStateAvailability(state, results);

  expect(errors.length).toBe(0);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/state/validation.test.ts`
Expected: FAIL - validateStateAvailability not defined

**Step 3: Write minimal implementation**

```typescript
// Add to src/state/validation.ts
static validateStateAvailability(
  state: InvestigationState,
  results: Array<{ nodeId: string; state: NodeState }>
): ValidationError[] {
  const errors: ValidationError[] = [];
  const round = state.data.currentRound;

  // States locked until certain rounds
  const STATE_UNLOCK_ROUND: Partial<Record<NodeState, number>> = {
    [NodeState.VALID]: 3,
    [NodeState.VALID_PENDING]: 3,
    [NodeState.SPEC]: 3,
  };

  for (const result of results) {
    const unlockRound = STATE_UNLOCK_ROUND[result.state];
    if (unlockRound && round < unlockRound) {
      errors.push({
        nodeId: result.nodeId,
        error: "STATE_LOCKED",
        message: `${result.state} is not available until round ${unlockRound}. Current round: ${round}`,
        suggestion: `Use DRILL or VERIFY to continue exploration, or DEAD if truly a dead end`,
      });
    }
  }

  return errors;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/state/validation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/state/validation.ts src/state/validation.test.ts
git commit -m "feat: lock VALID/SPEC states until round 3"
```

### Task 2.3: Integrate New Validations into Commit Handler

**Files:**
- Modify: `src/tools/commit.ts`
- Test: `src/tools/commit.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/tools/commit.test.ts
test("rejects VALID before round 3 via commit", async () => {
  // Start fresh at round 1
  const startResult = await handleStart({ query: "Test", minRoots: 2 }, TEST_DIR);
  const sessionId = startResult.sessionId;

  await handlePropose(
    {
      sessionId,
      nodes: [
        { id: "R1.A", parent: null, title: "A", plannedAction: "A" },
        { id: "R1.B", parent: null, title: "B", plannedAction: "B" },
      ],
    },
    TEST_DIR
  );

  const result = await handleCommit(
    {
      sessionId,
      results: [
        { nodeId: "R1.A", state: NodeState.VALID, findings: "Found", evidence: "This is detailed evidence with more than 50 characters for validation" },
        { nodeId: "R1.B", state: NodeState.DRILL, findings: "More" },
      ],
    },
    TEST_DIR
  );

  expect(result.status).toBe("REJECTED");
  expect(result.errors.some((e) => e.error === "STATE_LOCKED")).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/tools/commit.test.ts`
Expected: FAIL - commit doesn't check state availability

**Step 3: Write minimal implementation**

```typescript
// In src/tools/commit.ts handleCommit function, after evidence validation (around line 88):

// Validate state availability (round-locked states)
const stateResults = input.results.map((r) => ({ nodeId: r.nodeId, state: r.state }));
errors.push(...Validator.validateStateAvailability(state, stateResults));

// Validate terminal ratio
errors.push(...Validator.validateTerminalRatio(state, stateResults, state.data.currentRound));

if (errors.length > 0) {
  return {
    status: "REJECTED",
    errors,
    dot: "",
    currentRound: state.data.currentRound,
    batchComplete: false,
    roundComplete: false,
    nextRoundInfo: { round: 0, nodesRequired: 0, totalBatches: 0, parentBreakdown: [] },
    message: `Commit rejected: ${errors.length} validation error(s)`,
  };
}
```

Also add import at top:
```typescript
import { Validator } from "../state/validation";
```

**Step 4: Run test to verify it passes**

Run: `bun test src/tools/commit.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/commit.ts src/tools/commit.test.ts
git commit -m "feat: integrate terminal ratio and state lock validations into commit"
```

---

## Batch 3: VALID_PENDING Confirmation Flow

**Goal:** Implement the confirmation child requirement for VALID_PENDING nodes.

### Task 3.1: Track Pending Validations in Investigation State

**Files:**
- Modify: `src/types.ts:55-65`
- Modify: `src/state/investigation.ts`
- Test: `src/state/investigation.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/state/investigation.test.ts
test("tracks nodes awaiting confirmation", () => {
  const state = InvestigationState.create("Test", 5, TEST_DIR);

  state.addNode({
    id: "R3.A1",
    parent: "R2.A",
    state: NodeState.VALID_PENDING,
    title: "Pending validation",
    findings: "Found something",
    children: [],
    round: 3,
  });

  const pending = state.getNodesAwaitingConfirmation();
  expect(pending).toHaveLength(1);
  expect(pending[0].id).toBe("R3.A1");
});

test("confirms pending validation when child is VALID", () => {
  const state = InvestigationState.create("Test", 5, TEST_DIR);

  state.addNode({
    id: "R3.A1",
    parent: "R2.A",
    state: NodeState.VALID_PENDING,
    title: "Pending",
    findings: "Found",
    children: [],
    round: 3,
  });

  // Add confirming child
  state.addNode({
    id: "R4.A1a",
    parent: "R3.A1",
    state: NodeState.VALID,
    title: "Confirmed",
    findings: "Verified",
    children: [],
    round: 4,
  });

  state.processConfirmations();

  const node = state.getNode("R3.A1");
  expect(node?.state).toBe(NodeState.VALID);
});

test("reverts pending validation when child is DEAD", () => {
  const state = InvestigationState.create("Test", 5, TEST_DIR);

  state.addNode({
    id: "R3.A1",
    parent: "R2.A",
    state: NodeState.VALID_PENDING,
    title: "Pending",
    findings: "Found",
    children: [],
    round: 3,
  });

  // Add rejecting child
  state.addNode({
    id: "R4.A1a",
    parent: "R3.A1",
    state: NodeState.DEAD,
    title: "Rejected",
    findings: "Actually not valid",
    children: [],
    round: 4,
  });

  state.processConfirmations();

  const node = state.getNode("R3.A1");
  expect(node?.state).toBe(NodeState.DRILL); // Reverted to DRILL for more exploration
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/state/investigation.test.ts`
Expected: FAIL - getNodesAwaitingConfirmation not defined

**Step 3: Write minimal implementation**

```typescript
// Add to src/state/investigation.ts

getNodesAwaitingConfirmation(): ToTNode[] {
  return Object.values(this.data.nodes).filter(
    (n) => n.state === NodeState.VALID_PENDING
  );
}

processConfirmations(): void {
  const pendingNodes = this.getNodesAwaitingConfirmation();

  for (const pending of pendingNodes) {
    if (pending.children.length === 0) continue;

    // Check first confirmation child
    const confirmChild = this.getNode(pending.children[0]);
    if (!confirmChild) continue;

    if (confirmChild.state === NodeState.VALID) {
      // Confirmed - upgrade to VALID
      this.updateNode(pending.id, { state: NodeState.VALID });
    } else if (confirmChild.state === NodeState.DEAD) {
      // Rejected - revert to DRILL for more exploration
      this.updateNode(pending.id, { state: NodeState.DRILL });
    }
    // If child is DRILL/VERIFY, wait for it to resolve
  }
}
```

Also add import at top of investigation.ts:
```typescript
import { NodeState } from "../types";
```

**Step 4: Run test to verify it passes**

Run: `bun test src/state/investigation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/state/investigation.ts src/state/investigation.test.ts
git commit -m "feat: add VALID_PENDING confirmation processing"
```

### Task 3.2: Call processConfirmations in Commit Handler

**Files:**
- Modify: `src/tools/commit.ts`
- Test: `src/tools/commit.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/tools/commit.test.ts
test("processes confirmations after commit", async () => {
  // Setup a VALID_PENDING node
  const startResult = await handleStart({ query: "Test", minRoots: 1 }, TEST_DIR);
  const sessionId = startResult.sessionId;

  // Round 1
  await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "A", plannedAction: "A" }] }, TEST_DIR);
  await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" }] }, TEST_DIR);

  // Round 2
  await handlePropose({ sessionId, nodes: [
    { id: "R2.A1", parent: "R1.A", title: "A1", plannedAction: "A1" },
    { id: "R2.A2", parent: "R1.A", title: "A2", plannedAction: "A2" },
    { id: "R2.A3", parent: "R1.A", title: "A3", plannedAction: "A3" },
  ] }, TEST_DIR);
  await handleCommit({ sessionId, results: [
    { nodeId: "R2.A1", state: NodeState.DRILL, findings: "More" },
    { nodeId: "R2.A2", state: NodeState.DRILL, findings: "More" },
    { nodeId: "R2.A3", state: NodeState.DEAD, findings: "Dead", evidence: "Exhaustive testing showed this path leads nowhere due to X" },
  ] }, TEST_DIR);

  // Round 3 - create VALID_PENDING
  await handlePropose({ sessionId, nodes: [
    { id: "R3.A1a", parent: "R2.A1", title: "A1a", plannedAction: "A1a" },
    { id: "R3.A1b", parent: "R2.A1", title: "A1b", plannedAction: "A1b" },
    { id: "R3.A1c", parent: "R2.A1", title: "A1c", plannedAction: "A1c" },
    { id: "R3.A2a", parent: "R2.A2", title: "A2a", plannedAction: "A2a" },
  ] }, TEST_DIR);
  await handleCommit({ sessionId, results: [
    { nodeId: "R3.A1a", state: NodeState.VALID_PENDING, findings: "Found solution!", evidence: "This solution works because of detailed reasoning that exceeds 50 chars" },
    { nodeId: "R3.A1b", state: NodeState.DEAD, findings: "Dead", evidence: "This approach failed because of X, Y, Z which are insurmountable" },
    { nodeId: "R3.A1c", state: NodeState.DRILL, findings: "More to check" },
    { nodeId: "R3.A2a", state: NodeState.DRILL, findings: "Exploring" },
  ] }, TEST_DIR);

  // Round 4 - confirm the VALID_PENDING
  await handlePropose({ sessionId, nodes: [
    { id: "R4.A1a1", parent: "R3.A1a", title: "Confirm", plannedAction: "Verify solution" },
  ] }, TEST_DIR);
  const result = await handleCommit({ sessionId, results: [
    { nodeId: "R4.A1a1", state: NodeState.VALID, findings: "Confirmed!", evidence: "Verification complete - solution works as expected in all test cases" },
  ] }, TEST_DIR);

  // Check that parent was promoted
  const state = InvestigationState.load(sessionId, TEST_DIR);
  const parentNode = state?.getNode("R3.A1a");
  expect(parentNode?.state).toBe(NodeState.VALID);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/tools/commit.test.ts`
Expected: FAIL - processConfirmations not called

**Step 3: Write minimal implementation**

```typescript
// In src/tools/commit.ts, after state.save() (around line 144):

// Process any pending confirmations
state.processConfirmations();
state.save();
```

**Step 4: Run test to verify it passes**

Run: `bun test src/tools/commit.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/commit.ts src/tools/commit.test.ts
git commit -m "feat: process VALID_PENDING confirmations in commit handler"
```

---

## Batch 4: Quality Score System + End Gate

**Goal:** Implement quality score calculation and gate tot_end on minimum quality threshold.

### Task 4.1: Add Quality Metrics Calculator

**Files:**
- Create: `src/state/quality.ts`
- Create: `src/state/quality.test.ts`

**Step 1: Write the failing test**

```typescript
// Create src/state/quality.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { QualityCalculator } from "./quality";
import { InvestigationState } from "./investigation";
import { NodeState } from "../types";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("QualityCalculator", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  test("calculates depth score", () => {
    const state = InvestigationState.create("Test", 1, TEST_DIR);

    // Build tree with max depth 4
    state.addNode({ id: "R1.A", parent: null, state: NodeState.DRILL, title: "A", findings: null, children: ["R2.A1"], round: 1 });
    state.addNode({ id: "R2.A1", parent: "R1.A", state: NodeState.DRILL, title: "A1", findings: null, children: ["R3.A1a"], round: 2 });
    state.addNode({ id: "R3.A1a", parent: "R2.A1", state: NodeState.DRILL, title: "A1a", findings: null, children: ["R4.A1a1"], round: 3 });
    state.addNode({ id: "R4.A1a1", parent: "R3.A1a", state: NodeState.VALID, title: "A1a1", findings: "Done", children: [], round: 4 });

    const quality = QualityCalculator.calculate(state);

    expect(quality.maxDepth).toBe(4);
    expect(quality.depthScore).toBeCloseTo(0.8, 1); // 4/5 = 0.8
  });

  test("calculates breadth score", () => {
    const state = InvestigationState.create("Test", 1, TEST_DIR);

    // Root with 3 children
    state.addNode({ id: "R1.A", parent: null, state: NodeState.DRILL, title: "A", findings: null, children: ["R2.A1", "R2.A2", "R2.A3"], round: 1 });
    state.addNode({ id: "R2.A1", parent: "R1.A", state: NodeState.DEAD, title: "A1", findings: "Dead", children: [], round: 2 });
    state.addNode({ id: "R2.A2", parent: "R1.A", state: NodeState.DEAD, title: "A2", findings: "Dead", children: [], round: 2 });
    state.addNode({ id: "R2.A3", parent: "R1.A", state: NodeState.VALID, title: "A3", findings: "Done", children: [], round: 2 });

    const quality = QualityCalculator.calculate(state);

    expect(quality.avgBranchingFactor).toBeCloseTo(3, 0); // 3 children / 1 parent
    expect(quality.breadthScore).toBeCloseTo(1.0, 1); // 3/3 = 1.0 (capped at 1)
  });

  test("calculates balance score", () => {
    const state = InvestigationState.create("Test", 1, TEST_DIR);

    state.addNode({ id: "R1.A", parent: null, state: NodeState.DEAD, title: "A", findings: "Dead", children: [], round: 1 });
    state.addNode({ id: "R1.B", parent: null, state: NodeState.DEAD, title: "B", findings: "Dead", children: [], round: 1 });
    state.addNode({ id: "R1.C", parent: null, state: NodeState.VALID, title: "C", findings: "Valid", children: [], round: 1 });

    const quality = QualityCalculator.calculate(state);

    // 2 DEAD, 1 VALID -> ratio = 2/3 = 0.67
    expect(quality.balanceScore).toBeCloseTo(0.67, 1);
  });

  test("calculates composite quality score", () => {
    const state = InvestigationState.create("Test", 1, TEST_DIR);

    // Build reasonable investigation
    state.addNode({ id: "R1.A", parent: null, state: NodeState.DRILL, title: "A", findings: null, children: ["R2.A1", "R2.A2", "R2.A3"], round: 1 });
    state.addNode({ id: "R2.A1", parent: "R1.A", state: NodeState.DRILL, title: "A1", findings: null, children: ["R3.A1a", "R3.A1b", "R3.A1c"], round: 2 });
    state.addNode({ id: "R2.A2", parent: "R1.A", state: NodeState.DEAD, title: "A2", findings: "Dead", children: [], round: 2 });
    state.addNode({ id: "R2.A3", parent: "R1.A", state: NodeState.DEAD, title: "A3", findings: "Dead", children: [], round: 2 });
    state.addNode({ id: "R3.A1a", parent: "R2.A1", state: NodeState.DRILL, title: "A1a", findings: null, children: ["R4.A1a1", "R4.A1a2", "R4.A1a3"], round: 3 });
    state.addNode({ id: "R3.A1b", parent: "R2.A1", state: NodeState.DEAD, title: "A1b", findings: "Dead", children: [], round: 3 });
    state.addNode({ id: "R3.A1c", parent: "R2.A1", state: NodeState.DEAD, title: "A1c", findings: "Dead", children: [], round: 3 });
    state.addNode({ id: "R4.A1a1", parent: "R3.A1a", state: NodeState.VALID, title: "A1a1", findings: "Done", children: [], round: 4 });
    state.addNode({ id: "R4.A1a2", parent: "R3.A1a", state: NodeState.DEAD, title: "A1a2", findings: "Dead", children: [], round: 4 });
    state.addNode({ id: "R4.A1a3", parent: "R3.A1a", state: NodeState.DEAD, title: "A1a3", findings: "Dead", children: [], round: 4 });

    const quality = QualityCalculator.calculate(state);

    expect(quality.compositeScore).toBeGreaterThan(0.5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/state/quality.test.ts`
Expected: FAIL - QualityCalculator not found

**Step 3: Write minimal implementation**

```typescript
// Create src/state/quality.ts
import { InvestigationState } from "./investigation";
import { NodeState, isTerminalState } from "../types";

export interface QualityMetrics {
  maxDepth: number;
  avgDepth: number;
  avgBranchingFactor: number;
  terminalRatio: number;
  validToDeadRatio: number;
  depthScore: number;      // 0-1, based on maxDepth/5
  breadthScore: number;    // 0-1, based on avgBranchingFactor/3
  balanceScore: number;    // 0-1, based on DEAD/(DEAD+VALID)
  explorationScore: number; // 0-1, based on non-terminal work
  compositeScore: number;  // Weighted average
}

export class QualityCalculator {
  static calculate(state: InvestigationState): QualityMetrics {
    const nodes = state.getAllNodes();

    if (nodes.length === 0) {
      return {
        maxDepth: 0,
        avgDepth: 0,
        avgBranchingFactor: 0,
        terminalRatio: 0,
        validToDeadRatio: 0,
        depthScore: 0,
        breadthScore: 0,
        balanceScore: 0,
        explorationScore: 0,
        compositeScore: 0,
      };
    }

    // Calculate depth metrics
    const maxDepth = Math.max(...nodes.map((n) => n.round));
    const terminalNodes = nodes.filter((n) => isTerminalState(n.state));
    const avgDepth = terminalNodes.length > 0
      ? terminalNodes.reduce((sum, n) => sum + n.round, 0) / terminalNodes.length
      : 0;

    // Calculate branching factor
    const nodesWithChildren = nodes.filter((n) => n.children.length > 0);
    const avgBranchingFactor = nodesWithChildren.length > 0
      ? nodesWithChildren.reduce((sum, n) => sum + n.children.length, 0) / nodesWithChildren.length
      : 0;

    // Calculate terminal ratio
    const terminalRatio = terminalNodes.length / nodes.length;

    // Calculate VALID to DEAD ratio
    const validCount = nodes.filter((n) => n.state === NodeState.VALID).length;
    const deadCount = nodes.filter((n) => n.state === NodeState.DEAD).length;
    const validToDeadRatio = deadCount > 0 ? validCount / deadCount : validCount;

    // Calculate scores (0-1 scale)
    const depthScore = Math.min(maxDepth / 5, 1);
    const breadthScore = Math.min(avgBranchingFactor / 3, 1);

    // Balance score: more DEAD than VALID is better (means more exploration)
    const balanceScore = (deadCount + validCount) > 0
      ? deadCount / (deadCount + validCount)
      : 0;

    // Exploration score: ratio of non-terminal work before terminating
    const nonTerminalNodes = nodes.filter((n) => !isTerminalState(n.state));
    const explorationScore = nodes.length > 0
      ? nonTerminalNodes.length / nodes.length
      : 0;

    // Composite score: weighted average
    const compositeScore =
      0.30 * depthScore +
      0.30 * breadthScore +
      0.20 * balanceScore +
      0.20 * (1 - explorationScore); // Invert because fewer active = more resolved

    return {
      maxDepth,
      avgDepth,
      avgBranchingFactor,
      terminalRatio,
      validToDeadRatio,
      depthScore,
      breadthScore,
      balanceScore,
      explorationScore,
      compositeScore,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/state/quality.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/state/quality.ts src/state/quality.test.ts
git commit -m "feat: add QualityCalculator for investigation quality metrics"
```

### Task 4.2: Gate tot_end on Quality Threshold

**Files:**
- Modify: `src/state/validation.ts`
- Modify: `src/tools/end.ts`
- Test: `src/tools/end.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/tools/end.test.ts
test("rejects end when quality score below threshold", async () => {
  const startResult = await handleStart({ query: "Test", minRoots: 1 }, TEST_DIR);
  const sessionId = startResult.sessionId;

  // Build shallow investigation (low quality)
  await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "A", plannedAction: "A" }] }, TEST_DIR);
  await handleCommit({ sessionId, results: [{ nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" }] }, TEST_DIR);

  // Round 2 - minimum children
  await handlePropose({ sessionId, nodes: [
    { id: "R2.A1", parent: "R1.A", title: "A1", plannedAction: "A1" },
    { id: "R2.A2", parent: "R1.A", title: "A2", plannedAction: "A2" },
    { id: "R2.A3", parent: "R1.A", title: "A3", plannedAction: "A3" },
  ] }, TEST_DIR);
  await handleCommit({ sessionId, results: [
    { nodeId: "R2.A1", state: NodeState.DRILL, findings: "More" },
    { nodeId: "R2.A2", state: NodeState.DEAD, findings: "Dead", evidence: "This path is definitively a dead end due to technical limitations" },
    { nodeId: "R2.A3", state: NodeState.DEAD, findings: "Dead", evidence: "Another dead end discovered after exhaustive investigation" },
  ] }, TEST_DIR);

  // Round 3 - minimal exploration then try to end
  await handlePropose({ sessionId, nodes: [
    { id: "R3.A1a", parent: "R2.A1", title: "A1a", plannedAction: "A1a" },
    { id: "R3.A1b", parent: "R2.A1", title: "A1b", plannedAction: "A1b" },
    { id: "R3.A1c", parent: "R2.A1", title: "A1c", plannedAction: "A1c" },
  ] }, TEST_DIR);
  await handleCommit({ sessionId, results: [
    { nodeId: "R3.A1a", state: NodeState.VALID_PENDING, findings: "Found!", evidence: "This is the solution because of detailed technical reasoning here" },
    { nodeId: "R3.A1b", state: NodeState.DEAD, findings: "Dead", evidence: "Not viable due to constraints X, Y, and Z which are insurmountable" },
    { nodeId: "R3.A1c", state: NodeState.DEAD, findings: "Dead", evidence: "This approach fails because of fundamental limitations in the design" },
  ] }, TEST_DIR);

  const result = await handleEnd({ sessionId }, TEST_DIR);

  // Should be rejected because investigation is too shallow
  expect(result.status).toBe("REJECTED");
  expect(result.reason).toContain("quality");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/tools/end.test.ts`
Expected: FAIL - quality gate not implemented

**Step 3: Write minimal implementation**

```typescript
// Add to src/state/validation.ts
import { QualityCalculator } from "./quality";

// Update canEndInvestigation method - add quality gate at end:
static canEndInvestigation(state: InvestigationState): {
  canEnd: boolean;
  reason?: string;
  qualityScore?: number;
} {
  // ... existing checks ...

  // Quality gate - require minimum composite score
  const quality = QualityCalculator.calculate(state);
  const MIN_QUALITY_SCORE = 0.5;

  if (quality.compositeScore < MIN_QUALITY_SCORE) {
    return {
      canEnd: false,
      reason: `Investigation quality score ${quality.compositeScore.toFixed(2)} is below minimum ${MIN_QUALITY_SCORE}. Depth: ${quality.depthScore.toFixed(2)}, Breadth: ${quality.breadthScore.toFixed(2)}, Balance: ${quality.balanceScore.toFixed(2)}`,
      qualityScore: quality.compositeScore,
    };
  }

  return { canEnd: true, qualityScore: quality.compositeScore };
}
```

Update src/tools/end.ts to include quality info in response.

**Step 4: Run test to verify it passes**

Run: `bun test src/tools/end.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/state/validation.ts src/state/quality.ts src/tools/end.ts src/tools/end.test.ts
git commit -m "feat: gate tot_end on minimum quality score threshold"
```

### Task 4.3: Add Quality Metrics to Status Response

**Files:**
- Modify: `src/tools/status.ts`
- Test: `src/tools/status.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/tools/status.test.ts
test("includes quality metrics in status", async () => {
  await handlePropose(
    {
      sessionId,
      nodes: [
        { id: "R1.A", parent: null, title: "A", plannedAction: "A" },
        { id: "R1.B", parent: null, title: "B", plannedAction: "B" },
      ],
    },
    TEST_DIR
  );
  await handleCommit(
    {
      sessionId,
      results: [
        { nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" },
        { nodeId: "R1.B", state: NodeState.DRILL, findings: "Lead" },
      ],
    },
    TEST_DIR
  );

  const result = await handleStatus({ sessionId }, TEST_DIR);

  expect(result.quality).toBeDefined();
  expect(result.quality.depthScore).toBeDefined();
  expect(result.quality.breadthScore).toBeDefined();
  expect(result.quality.compositeScore).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/tools/status.test.ts`
Expected: FAIL - quality not in response

**Step 3: Write minimal implementation**

```typescript
// Modify src/tools/status.ts to add quality field
import { QualityCalculator, QualityMetrics } from "../state/quality";

// Add to StatusResult interface:
quality: QualityMetrics;

// In handleStatus, calculate and return:
const quality = QualityCalculator.calculate(state);

return {
  // ... existing fields ...
  quality,
};
```

**Step 4: Run test to verify it passes**

Run: `bun test src/tools/status.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/status.ts src/tools/status.test.ts
git commit -m "feat: include quality metrics in status response"
```

---

## Batch 5: Depth Requirements + Integration Testing

**Goal:** Enforce minimum depth requirement and ensure all components work together.

### Task 5.1: Add Minimum Depth Validation

**Files:**
- Modify: `src/state/validation.ts`
- Test: `src/state/validation.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/state/validation.test.ts
test("rejects end when max depth < 4", () => {
  const state = InvestigationState.create("Test", 1, TEST_DIR);
  state.data.currentRound = 3;

  // Only depth 3
  state.addNode({ id: "R1.A", parent: null, state: NodeState.DRILL, title: "A", findings: null, children: ["R2.A1"], round: 1 });
  state.addNode({ id: "R2.A1", parent: "R1.A", state: NodeState.DRILL, title: "A1", findings: null, children: ["R3.A1a"], round: 2 });
  state.addNode({ id: "R3.A1a", parent: "R2.A1", state: NodeState.VALID, title: "A1a", findings: "Done", children: [], round: 3 });

  const result = Validator.canEndInvestigation(state);

  expect(result.canEnd).toBe(false);
  expect(result.reason).toContain("depth");
});

test("allows end when max depth >= 4", () => {
  const state = InvestigationState.create("Test", 1, TEST_DIR);
  state.data.currentRound = 4;

  // Depth 4
  state.addNode({ id: "R1.A", parent: null, state: NodeState.DRILL, title: "A", findings: null, children: ["R2.A1", "R2.A2", "R2.A3"], round: 1 });
  state.addNode({ id: "R2.A1", parent: "R1.A", state: NodeState.DRILL, title: "A1", findings: null, children: ["R3.A1a", "R3.A1b", "R3.A1c"], round: 2 });
  state.addNode({ id: "R2.A2", parent: "R1.A", state: NodeState.DEAD, title: "A2", findings: "Dead", children: [], round: 2 });
  state.addNode({ id: "R2.A3", parent: "R1.A", state: NodeState.DEAD, title: "A3", findings: "Dead", children: [], round: 2 });
  state.addNode({ id: "R3.A1a", parent: "R2.A1", state: NodeState.DRILL, title: "A1a", findings: null, children: ["R4.A1a1", "R4.A1a2", "R4.A1a3"], round: 3 });
  state.addNode({ id: "R3.A1b", parent: "R2.A1", state: NodeState.DEAD, title: "A1b", findings: "Dead", children: [], round: 3 });
  state.addNode({ id: "R3.A1c", parent: "R2.A1", state: NodeState.DEAD, title: "A1c", findings: "Dead", children: [], round: 3 });
  state.addNode({ id: "R4.A1a1", parent: "R3.A1a", state: NodeState.VALID, title: "A1a1", findings: "Done", children: [], round: 4 });
  state.addNode({ id: "R4.A1a2", parent: "R3.A1a", state: NodeState.DEAD, title: "A1a2", findings: "Dead", children: [], round: 4 });
  state.addNode({ id: "R4.A1a3", parent: "R3.A1a", state: NodeState.DEAD, title: "A1a3", findings: "Dead", children: [], round: 4 });

  const result = Validator.canEndInvestigation(state);

  expect(result.canEnd).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/state/validation.test.ts`
Expected: FAIL - depth check not in canEndInvestigation

**Step 3: Write minimal implementation**

```typescript
// Add to canEndInvestigation in src/state/validation.ts, before quality check:

// Minimum depth requirement
const MIN_DEPTH = 4;
const quality = QualityCalculator.calculate(state);

if (quality.maxDepth < MIN_DEPTH) {
  return {
    canEnd: false,
    reason: `Investigation must reach depth ${MIN_DEPTH}. Current max depth: ${quality.maxDepth}`,
    qualityScore: quality.compositeScore,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/state/validation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/state/validation.ts src/state/validation.test.ts
git commit -m "feat: require minimum depth 4 before ending investigation"
```

### Task 5.2: Update CLAUDE.md with New Rules

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update documentation**

```markdown
# Tree of Thoughts MCP Server - Usage Guide

## Multi-Gate Validation System

This server enforces deep exploration through multiple validation layers:

### Layer 1: State Pipeline
- DRILL → VERIFY → VALID_PENDING → VALID (confirmed)
- Cannot skip steps; VALID requires confirmation child

### Layer 2: Round-Locked States
| Round | Available States |
|-------|------------------|
| 1-2 | DRILL, VERIFY, DEAD only |
| 3+ | All states including VALID_PENDING, SPEC |

### Layer 3: Terminal Ratio Limits
| Round | Max Terminal % |
|-------|----------------|
| 1 | 0% (except DEAD) |
| 2 | 35% |
| 3 | 50% |
| 4+ | 70% |

### Layer 4: Evidence Requirements
Terminal states (DEAD, VALID_PENDING, VALID, SPEC) require:
- `evidence`: Minimum 50 characters explaining conclusion
- `verificationMethod`: How this was verified (optional but recommended)
- `alternativesConsidered`: Other approaches tried (optional)

### Layer 5: VALID_PENDING Confirmation
1. Mark node as VALID_PENDING when you think you found a solution
2. Spawn confirmation child to verify
3. If child returns VALID → parent promoted to VALID
4. If child returns DEAD → parent reverted to DRILL

### Layer 6: End Gate Requirements
To call tot_end successfully:
- Minimum 4 rounds completed
- At least one path reaches depth 4
- Quality score >= 0.5
- All VALID_PENDING nodes confirmed or reverted
- No pending proposals

### Node ID Format
**Format:** `R[round].[suffix]`
- Round 1: R1.A, R1.B, R1.C
- Round 2: R2.A1, R2.A2 (children of R1.A)
- Round 3: R3.A1a, R3.A1b (children of R2.A1)
- Round 4: R4.A1a1 (children of R3.A1a)

### Required Children
| State | Min Children |
|-------|--------------|
| DRILL | 3 |
| VERIFY | 1 |
| VALID_PENDING | 1 (confirmation) |
| DEAD/VALID/SPEC | 0 (terminal) |

### Quality Score Components
- **depthScore** (30%): maxDepth / 5
- **breadthScore** (30%): avgBranchingFactor / 3
- **balanceScore** (20%): DEAD / (DEAD + VALID)
- **explorationScore** (20%): work before terminating

### Common Errors
| Error | Cause | Fix |
|-------|-------|-----|
| STATE_LOCKED | VALID before round 3 | Use DRILL/VERIFY until round 3 |
| TERMINAL_RATIO_EXCEEDED | Too many terminal in batch | Mark more as DRILL |
| MISSING_EVIDENCE | No evidence for terminal | Add evidence field (50+ chars) |
| QUALITY_TOO_LOW | Score < 0.5 | Explore deeper/wider |
| DEPTH_TOO_SHALLOW | Max depth < 4 | Continue to round 4+ |
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with multi-gate validation rules"
```

### Task 5.3: Export New Modules and Run Full Test Suite

**Files:**
- Modify: `src/state/index.ts`
- Modify: `src/index.ts` (MCP server)

**Step 1: Update exports**

```typescript
// src/state/index.ts
export { InvestigationState } from "./investigation";
export { Validator } from "./validation";
export { DotGenerator } from "./dot-generator";
export { QualityCalculator, type QualityMetrics } from "./quality";
```

**Step 2: Update MCP server enum for new state**

```typescript
// src/index.ts - Update the state enum in tot_commit schema
state: z.enum(["DRILL", "VERIFY", "DEAD", "VALID", "VALID_PENDING", "SPEC"]).describe("Result state"),
```

**Step 3: Run full test suite**

```bash
bun test
```

Expected: All tests pass

**Step 4: Commit**

```bash
git add src/state/index.ts src/index.ts
git commit -m "chore: export QualityCalculator and add VALID_PENDING to MCP schema"
```

---

## Verification

After all batches complete:

1. **Run full test suite:**
   ```bash
   bun test
   ```
   Expected: All tests pass

2. **Test MCP server manually:**
   ```bash
   bun run src/index.ts
   ```

3. **Verify enforcement by attempting:**
   - Mark VALID in round 1 → Should reject (STATE_LOCKED)
   - Submit >50% terminal in round 2 → Should reject (TERMINAL_RATIO_EXCEEDED)
   - Submit terminal without evidence → Should reject (MISSING_EVIDENCE)
   - End at depth 3 → Should reject (depth requirement)
   - End with quality < 0.5 → Should reject (quality gate)
