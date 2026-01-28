# Tree of Thoughts MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan batch by batch.

**Goal:** Build an MCP server that enforces Tree of Thoughts investigation methodology - tracking nodes, validating topology, preventing merges, and generating DOT graphs.

**Architecture:** Stateful MCP server with 6 tools (start, propose, commit, reclassify, status, end). Server owns all graph state and DOT generation. File-backed JSON persistence per investigation. Two-phase commit (propose validates, commit finalizes).

**Tech Stack:** TypeScript, Bun, @modelcontextprotocol/sdk, Zod for validation, uuid for session IDs

---

## Batch 1: Project Setup + Core Types + State Management

**Goal:** Initialize the Bun project, define all TypeScript types, and implement the Investigation state class with JSON persistence.

### Task 1.1: Project Initialization

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts` (placeholder)

**Step 1: Initialize project**

```bash
cd /home/nikketryhard/tree-of-thoughts-mcp
bun init -y
```

**Step 2: Install dependencies**

```bash
bun add @modelcontextprotocol/sdk zod uuid
bun add -d @types/uuid typescript
```

**Step 3: Configure tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "resolveJsonModule": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Update package.json scripts**

Add to package.json:
```json
{
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "bun test",
    "build": "bun build src/index.ts --outdir dist --target node"
  },
  "type": "module"
}
```

**Step 5: Create placeholder and commit**

```bash
mkdir -p src investigations
echo 'console.log("ToT MCP Server");' > src/index.ts
git init
git add -A
git commit -m "chore: initialize bun project with dependencies"
```

---

### Task 1.2: Core Type Definitions

**Files:**
- Create: `src/types.ts`
- Test: `src/types.test.ts`

**Step 1: Write the failing test**

```typescript
// src/types.test.ts
import { describe, expect, test } from "bun:test";
import { NodeState, isTerminalState, getRequiredChildren } from "./types";

describe("NodeState", () => {
  test("terminal states are correctly identified", () => {
    expect(isTerminalState(NodeState.DEAD)).toBe(true);
    expect(isTerminalState(NodeState.VALID)).toBe(true);
    expect(isTerminalState(NodeState.SPEC)).toBe(true);
    expect(isTerminalState(NodeState.DRILL)).toBe(false);
    expect(isTerminalState(NodeState.VERIFY)).toBe(false);
  });

  test("required children count is correct", () => {
    expect(getRequiredChildren(NodeState.DRILL)).toBe(2);
    expect(getRequiredChildren(NodeState.VERIFY)).toBe(1);
    expect(getRequiredChildren(NodeState.DEAD)).toBe(0);
    expect(getRequiredChildren(NodeState.VALID)).toBe(0);
    expect(getRequiredChildren(NodeState.SPEC)).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/types.test.ts
```
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/types.ts

export enum NodeState {
  DRILL = "DRILL",       // lightblue - needs >= 2 children
  VERIFY = "VERIFY",     // purple - needs >= 1 child
  DEAD = "DEAD",         // red - terminal
  VALID = "VALID",       // green - terminal (solution)
  SPEC = "SPEC",         // gold - terminal (theory)
}

export const STATE_COLORS: Record<NodeState, string> = {
  [NodeState.DRILL]: "lightblue",
  [NodeState.VERIFY]: "purple",
  [NodeState.DEAD]: "red",
  [NodeState.VALID]: "green",
  [NodeState.SPEC]: "gold",
};

export function isTerminalState(state: NodeState): boolean {
  return [NodeState.DEAD, NodeState.VALID, NodeState.SPEC].includes(state);
}

export function getRequiredChildren(state: NodeState): number {
  switch (state) {
    case NodeState.DRILL:
      return 2;
    case NodeState.VERIFY:
      return 1;
    default:
      return 0;
  }
}

export interface ToTNode {
  id: string;              // e.g., "R1.A", "R2.A1"
  parent: string | null;   // null for root nodes
  state: NodeState;
  title: string;
  findings: string | null;
  children: string[];      // child node IDs
  round: number;
}

export interface ProposedNode {
  id: string;
  parent: string | null;
  title: string;
  plannedAction: string;
}

export interface CommitResult {
  nodeId: string;
  state: NodeState;
  findings: string;
}

export interface Investigation {
  sessionId: string;
  query: string;
  minRoots: number;
  currentRound: number;
  currentBatch: number;
  nodes: Record<string, ToTNode>;
  queue: string[];         // pending node IDs for current round
  createdAt: string;
  updatedAt: string;
}

export interface ValidationError {
  nodeId: string;
  error: string;
  message: string;
  suggestion?: string;
}

export interface BatchStatus {
  sessionId: string;
  currentRound: number;
  currentBatch: number;
  totalBatchesInRound: number;
  nodesInQueue: number;
  activeDrills: number;
  activeVerifies: number;
  terminalNodes: number;
  canEnd: boolean;
  dot: string;
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/types.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/types.test.ts
git commit -m "feat: add core type definitions and state helpers"
```

---

### Task 1.3: Investigation State Class

**Files:**
- Create: `src/state/investigation.ts`
- Test: `src/state/investigation.test.ts`

**Step 1: Write the failing test**

```typescript
// src/state/investigation.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { InvestigationState } from "./investigation";
import { NodeState } from "../types";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("InvestigationState", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("creates new investigation with correct defaults", () => {
    const state = InvestigationState.create("Test query", 5, TEST_DIR);

    expect(state.data.query).toBe("Test query");
    expect(state.data.minRoots).toBe(5);
    expect(state.data.currentRound).toBe(1);
    expect(state.data.currentBatch).toBe(0);
    expect(Object.keys(state.data.nodes)).toHaveLength(0);
  });

  test("persists and loads from file", () => {
    const state = InvestigationState.create("Persist test", 5, TEST_DIR);
    const sessionId = state.data.sessionId;
    state.save();

    const loaded = InvestigationState.load(sessionId, TEST_DIR);
    expect(loaded).not.toBeNull();
    expect(loaded!.data.query).toBe("Persist test");
  });

  test("adds node correctly", () => {
    const state = InvestigationState.create("Node test", 5, TEST_DIR);

    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Test node",
      findings: null,
      children: [],
      round: 1,
    });

    expect(state.data.nodes["R1.A"]).toBeDefined();
    expect(state.data.nodes["R1.A"].title).toBe("Test node");
  });

  test("getNode returns node or null", () => {
    const state = InvestigationState.create("Get test", 5, TEST_DIR);

    expect(state.getNode("R1.A")).toBeNull();

    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Test",
      findings: null,
      children: [],
      round: 1,
    });

    expect(state.getNode("R1.A")).not.toBeNull();
  });

  test("tracks parent-child relationships", () => {
    const state = InvestigationState.create("Relationship test", 5, TEST_DIR);

    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Parent",
      findings: null,
      children: [],
      round: 1,
    });

    state.addNode({
      id: "R2.A1",
      parent: "R1.A",
      state: NodeState.DRILL,
      title: "Child",
      findings: null,
      children: [],
      round: 2,
    });

    expect(state.data.nodes["R1.A"].children).toContain("R2.A1");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/state/investigation.test.ts
```
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/state/investigation.ts
import { v4 as uuidv4 } from "uuid";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Investigation, ToTNode } from "../types";

export class InvestigationState {
  public data: Investigation;
  private persistDir: string;

  private constructor(data: Investigation, persistDir: string) {
    this.data = data;
    this.persistDir = persistDir;
  }

  static create(
    query: string,
    minRoots: number = 5,
    persistDir: string = "./investigations"
  ): InvestigationState {
    const now = new Date().toISOString();
    const data: Investigation = {
      sessionId: uuidv4(),
      query,
      minRoots,
      currentRound: 1,
      currentBatch: 0,
      nodes: {},
      queue: [],
      createdAt: now,
      updatedAt: now,
    };
    return new InvestigationState(data, persistDir);
  }

  static load(
    sessionId: string,
    persistDir: string = "./investigations"
  ): InvestigationState | null {
    const filePath = join(persistDir, `${sessionId}.json`);
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, "utf-8");
    const data = JSON.parse(content) as Investigation;
    return new InvestigationState(data, persistDir);
  }

  save(): void {
    if (!existsSync(this.persistDir)) {
      mkdirSync(this.persistDir, { recursive: true });
    }
    this.data.updatedAt = new Date().toISOString();
    const filePath = join(this.persistDir, `${this.data.sessionId}.json`);
    writeFileSync(filePath, JSON.stringify(this.data, null, 2));
  }

  addNode(node: ToTNode): void {
    this.data.nodes[node.id] = node;

    // Update parent's children array
    if (node.parent && this.data.nodes[node.parent]) {
      if (!this.data.nodes[node.parent].children.includes(node.id)) {
        this.data.nodes[node.parent].children.push(node.id);
      }
    }
  }

  getNode(id: string): ToTNode | null {
    return this.data.nodes[id] ?? null;
  }

  updateNode(id: string, updates: Partial<ToTNode>): void {
    if (this.data.nodes[id]) {
      this.data.nodes[id] = { ...this.data.nodes[id], ...updates };
    }
  }

  getNodesByRound(round: number): ToTNode[] {
    return Object.values(this.data.nodes).filter((n) => n.round === round);
  }

  getNodesByState(state: string): ToTNode[] {
    return Object.values(this.data.nodes).filter((n) => n.state === state);
  }

  getAllNodes(): ToTNode[] {
    return Object.values(this.data.nodes);
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/state/investigation.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/state/investigation.ts src/state/investigation.test.ts
git commit -m "feat: add InvestigationState class with persistence"
```

---

## Batch 2: Validation Logic + DOT Generator

**Goal:** Implement all validation rules (topology, state transitions, reclassification) and the DOT graph generator.

### Task 2.1: Validation Rules

**Files:**
- Create: `src/state/validation.ts`
- Test: `src/state/validation.test.ts`

**Step 1: Write the failing test**

```typescript
// src/state/validation.test.ts
import { describe, expect, test } from "bun:test";
import { Validator } from "./validation";
import { InvestigationState } from "./investigation";
import { NodeState, type ProposedNode } from "../types";

const TEST_DIR = "./test-investigations";

describe("Validator", () => {
  test("rejects node with non-existent parent", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    const proposed: ProposedNode = {
      id: "R2.A1",
      parent: "R1.A", // doesn't exist
      title: "Test",
      plannedAction: "Do something",
    };

    const errors = Validator.validateProposedNode(proposed, state);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe("PARENT_NOT_FOUND");
  });

  test("rejects node with terminal parent", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.VALID, // terminal
      title: "Parent",
      findings: null,
      children: [],
      round: 1,
    });

    const proposed: ProposedNode = {
      id: "R2.A1",
      parent: "R1.A",
      title: "Child",
      plannedAction: "Do something",
    };

    const errors = Validator.validateProposedNode(proposed, state);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe("TERMINAL_PARENT");
  });

  test("accepts node with DRILL parent", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Parent",
      findings: null,
      children: [],
      round: 1,
    });

    const proposed: ProposedNode = {
      id: "R2.A1",
      parent: "R1.A",
      title: "Child",
      plannedAction: "Do something",
    };

    const errors = Validator.validateProposedNode(proposed, state);
    expect(errors).toHaveLength(0);
  });

  test("rejects duplicate node ID", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Existing",
      findings: null,
      children: [],
      round: 1,
    });

    const proposed: ProposedNode = {
      id: "R1.A", // duplicate
      parent: null,
      title: "Duplicate",
      plannedAction: "Do something",
    };

    const errors = Validator.validateProposedNode(proposed, state);
    expect(errors[0].error).toBe("DUPLICATE_ID");
  });

  test("rejects reclassification of node with children to terminal", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Parent",
      findings: null,
      children: ["R2.A1"],
      round: 1,
    });
    state.addNode({
      id: "R2.A1",
      parent: "R1.A",
      state: NodeState.DRILL,
      title: "Child",
      findings: null,
      children: [],
      round: 2,
    });

    const errors = Validator.validateReclassification("R1.A", NodeState.DEAD, state);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe("HAS_CHILDREN");
  });

  test("allows reclassification of terminal to active", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DEAD,
      title: "Dead node",
      findings: null,
      children: [],
      round: 1,
    });

    const errors = Validator.validateReclassification("R1.A", NodeState.DRILL, state);
    expect(errors).toHaveLength(0);
  });

  test("validates DRILL nodes have enough children at round end", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Drill with 1 child",
      findings: null,
      children: ["R2.A1"], // only 1, needs 2
      round: 1,
    });

    const errors = Validator.validateRoundCompletion(state, 1);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe("INSUFFICIENT_CHILDREN");
  });

  test("validates investigation can end", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.data.currentRound = 2; // less than 3
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.VALID,
      title: "Valid",
      findings: null,
      children: [],
      round: 1,
    });

    const result = Validator.canEndInvestigation(state);
    expect(result.canEnd).toBe(false);
    expect(result.reason).toContain("round");
  });

  test("allows end when round >= 3 and all terminal", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.data.currentRound = 3;
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.VALID,
      title: "Valid",
      findings: "Found it",
      children: [],
      round: 1,
    });

    const result = Validator.canEndInvestigation(state);
    expect(result.canEnd).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/state/validation.test.ts
```
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/state/validation.ts
import { NodeState, isTerminalState, getRequiredChildren, type ValidationError, type ProposedNode } from "../types";
import type { InvestigationState } from "./investigation";

export class Validator {
  static validateProposedNode(
    proposed: ProposedNode,
    state: InvestigationState
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check for duplicate ID
    if (state.getNode(proposed.id)) {
      errors.push({
        nodeId: proposed.id,
        error: "DUPLICATE_ID",
        message: `Node ${proposed.id} already exists`,
        suggestion: "Use a unique node ID",
      });
    }

    // Check parent exists (if not a root)
    if (proposed.parent !== null) {
      const parent = state.getNode(proposed.parent);
      if (!parent) {
        errors.push({
          nodeId: proposed.id,
          error: "PARENT_NOT_FOUND",
          message: `Parent node ${proposed.parent} does not exist`,
          suggestion: "Ensure parent node is committed before proposing children",
        });
      } else if (isTerminalState(parent.state)) {
        errors.push({
          nodeId: proposed.id,
          error: "TERMINAL_PARENT",
          message: `Parent ${proposed.parent} is ${parent.state} (terminal). Cannot spawn children from terminal nodes.`,
          suggestion: `Reclassify ${proposed.parent} to DRILL or VERIFY first using tot_reclassify`,
        });
      }
    }

    // Validate node ID format
    const idPattern = /^R\d+\.[A-Za-z0-9]+$/;
    if (!idPattern.test(proposed.id)) {
      errors.push({
        nodeId: proposed.id,
        error: "INVALID_ID_FORMAT",
        message: `Node ID ${proposed.id} does not match format R[round].[id]`,
        suggestion: "Use format like R1.A, R2.A1, R3.A1a",
      });
    }

    return errors;
  }

  static validateProposedBatch(
    proposed: ProposedNode[],
    state: InvestigationState
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check batch size
    if (proposed.length > 5) {
      errors.push({
        nodeId: "BATCH",
        error: "BATCH_OVERFLOW",
        message: `Batch contains ${proposed.length} nodes, maximum is 5`,
        suggestion: "Split into multiple batches of 5 or fewer",
      });
    }

    // Check for duplicate IDs within batch
    const ids = proposed.map((p) => p.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    for (const dup of duplicates) {
      errors.push({
        nodeId: dup,
        error: "DUPLICATE_IN_BATCH",
        message: `Node ID ${dup} appears multiple times in batch`,
        suggestion: "Ensure each node has a unique ID",
      });
    }

    // Validate each node
    for (const node of proposed) {
      errors.push(...this.validateProposedNode(node, state));
    }

    return errors;
  }

  static validateReclassification(
    nodeId: string,
    newState: NodeState,
    state: InvestigationState
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const node = state.getNode(nodeId);

    if (!node) {
      errors.push({
        nodeId,
        error: "NODE_NOT_FOUND",
        message: `Node ${nodeId} does not exist`,
        suggestion: "Check node ID spelling",
      });
      return errors;
    }

    // Cannot reclassify to terminal if has children
    if (isTerminalState(newState) && node.children.length > 0) {
      errors.push({
        nodeId,
        error: "HAS_CHILDREN",
        message: `Cannot reclassify ${nodeId} to ${newState} because it has ${node.children.length} children`,
        suggestion: "Resolve or reclassify children first, or reclassify to DRILL/VERIFY",
      });
    }

    return errors;
  }

  static validateRoundCompletion(
    state: InvestigationState,
    round: number
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const nodesInRound = state.getNodesByRound(round);

    for (const node of nodesInRound) {
      if (!isTerminalState(node.state)) {
        const required = getRequiredChildren(node.state);
        if (node.children.length < required) {
          errors.push({
            nodeId: node.id,
            error: "INSUFFICIENT_CHILDREN",
            message: `${node.state} node ${node.id} has ${node.children.length} children but requires >= ${required}`,
            suggestion: `Add more children to ${node.id} or reclassify it to a terminal state`,
          });
        }
      }
    }

    return errors;
  }

  static canEndInvestigation(state: InvestigationState): {
    canEnd: boolean;
    reason?: string;
  } {
    // Check minimum rounds
    if (state.data.currentRound < 3) {
      const allNodes = state.getAllNodes();
      const allTerminal = allNodes.every((n) => isTerminalState(n.state));

      if (allTerminal && allNodes.length > 0) {
        return {
          canEnd: false,
          reason: `RECOVERY_REQUIRED: All nodes are terminal but only at round ${state.data.currentRound}. Must reach round 3 or spawn new lateral roots.`,
        };
      }

      return {
        canEnd: false,
        reason: `Investigation is at round ${state.data.currentRound}, minimum 3 rounds required`,
      };
    }

    // Check all nodes are terminal
    const allNodes = state.getAllNodes();
    const nonTerminal = allNodes.filter((n) => !isTerminalState(n.state));

    if (nonTerminal.length > 0) {
      return {
        canEnd: false,
        reason: `${nonTerminal.length} nodes still active: ${nonTerminal.map((n) => n.id).join(", ")}`,
      };
    }

    // Check queue is empty
    if (state.data.queue.length > 0) {
      return {
        canEnd: false,
        reason: `Queue still has ${state.data.queue.length} pending nodes`,
      };
    }

    return { canEnd: true };
  }

  static validateMinRoots(
    state: InvestigationState,
    proposedCount: number
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const existingRoots = state.getNodesByRound(1).length;
    const totalRoots = existingRoots + proposedCount;

    if (state.data.currentRound === 1 && totalRoots < state.data.minRoots) {
      errors.push({
        nodeId: "BATCH",
        error: "INSUFFICIENT_ROOTS",
        message: `Round 1 requires at least ${state.data.minRoots} root nodes. Current: ${existingRoots}, Proposed: ${proposedCount}, Total: ${totalRoots}`,
        suggestion: `Add ${state.data.minRoots - totalRoots} more root nodes`,
      });
    }

    return errors;
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/state/validation.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/state/validation.ts src/state/validation.test.ts
git commit -m "feat: add validation rules for topology and state transitions"
```

---

### Task 2.2: DOT Graph Generator

**Files:**
- Create: `src/state/dot-generator.ts`
- Test: `src/state/dot-generator.test.ts`

**Step 1: Write the failing test**

```typescript
// src/state/dot-generator.test.ts
import { describe, expect, test } from "bun:test";
import { DotGenerator } from "./dot-generator";
import { InvestigationState } from "./investigation";
import { NodeState } from "../types";

const TEST_DIR = "./test-investigations";

describe("DotGenerator", () => {
  test("generates empty graph for new investigation", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    const dot = DotGenerator.generate(state);

    expect(dot).toContain("digraph Investigation");
    expect(dot).toContain("rankdir=TB");
  });

  test("generates node with correct color", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Test Node",
      findings: null,
      children: [],
      round: 1,
    });

    const dot = DotGenerator.generate(state);
    expect(dot).toContain("R1_A"); // sanitized ID
    expect(dot).toContain("fillcolor=lightblue");
    expect(dot).toContain("Test Node");
  });

  test("generates edges between parent and child", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: "Parent",
      findings: null,
      children: [],
      round: 1,
    });
    state.addNode({
      id: "R2.A1",
      parent: "R1.A",
      state: NodeState.VALID,
      title: "Child",
      findings: null,
      children: [],
      round: 2,
    });

    const dot = DotGenerator.generate(state);
    expect(dot).toContain("R1_A -> R2_A1");
  });

  test("includes legend", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    const dot = DotGenerator.generate(state);

    expect(dot).toContain("cluster_legend");
    expect(dot).toContain("DRILL");
    expect(dot).toContain("VERIFY");
    expect(dot).toContain("DEAD");
    expect(dot).toContain("VALID");
    expect(dot).toContain("SPEC");
  });

  test("escapes special characters in labels", () => {
    const state = InvestigationState.create("Test", 5, TEST_DIR);
    state.addNode({
      id: "R1.A",
      parent: null,
      state: NodeState.DRILL,
      title: 'Test "quotes" and <brackets>',
      findings: null,
      children: [],
      round: 1,
    });

    const dot = DotGenerator.generate(state);
    // Should not break DOT syntax
    expect(dot).not.toContain('""');
    expect(dot).toContain("quotes");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/state/dot-generator.test.ts
```
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/state/dot-generator.ts
import { NodeState, STATE_COLORS } from "../types";
import type { InvestigationState } from "./investigation";

export class DotGenerator {
  static generate(state: InvestigationState): string {
    const lines: string[] = [];

    lines.push("digraph Investigation {");
    lines.push("  rankdir=TB;");
    lines.push('  node [shape=box, style="filled,rounded", fontname="Arial"];');
    lines.push("");

    // Group nodes by round
    const maxRound = Math.max(
      0,
      ...Object.values(state.data.nodes).map((n) => n.round)
    );

    for (let round = 1; round <= maxRound; round++) {
      const nodesInRound = state.getNodesByRound(round);
      if (nodesInRound.length === 0) continue;

      lines.push(`  // --- Round ${round} ---`);

      for (const node of nodesInRound) {
        const sanitizedId = this.sanitizeId(node.id);
        const color = STATE_COLORS[node.state];
        const label = this.escapeLabel(
          `R${node.round} | ${node.title}\\n(${node.state})`
        );

        lines.push(
          `  ${sanitizedId} [fillcolor=${color}, label="${label}"];`
        );
      }
      lines.push("");
    }

    // Generate edges
    lines.push("  // --- Edges ---");
    for (const node of Object.values(state.data.nodes)) {
      if (node.parent) {
        const parentId = this.sanitizeId(node.parent);
        const childId = this.sanitizeId(node.id);
        lines.push(`  ${parentId} -> ${childId};`);
      }
    }
    lines.push("");

    // Legend
    lines.push("  // --- Legend ---");
    lines.push("  subgraph cluster_legend {");
    lines.push('    label="Taxonomy";');
    lines.push("    node [width=2];");
    lines.push(
      `    L_DRILL [label="DRILL (Lead)\\nSpawn >= 2", fillcolor=${STATE_COLORS[NodeState.DRILL]}];`
    );
    lines.push(
      `    L_VERIFY [label="VERIFY (Ambiguous)\\nSpawn >= 1", fillcolor=${STATE_COLORS[NodeState.VERIFY]}];`
    );
    lines.push(
      `    L_DEAD [label="DEAD (Pruned)\\nStop", fillcolor=${STATE_COLORS[NodeState.DEAD]}];`
    );
    lines.push(
      `    L_VALID [label="VALID (Solution)\\nStop", fillcolor=${STATE_COLORS[NodeState.VALID]}];`
    );
    lines.push(
      `    L_SPEC [label="SPEC (Theory)\\nStop", fillcolor=${STATE_COLORS[NodeState.SPEC]}];`
    );
    lines.push("  }");
    lines.push("}");

    return lines.join("\n");
  }

  private static sanitizeId(id: string): string {
    // DOT IDs can't have dots, replace with underscore
    return id.replace(/\./g, "_");
  }

  private static escapeLabel(label: string): string {
    return label
      .replace(/"/g, '\\"')
      .replace(/</g, "\\<")
      .replace(/>/g, "\\>");
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/state/dot-generator.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/state/dot-generator.ts src/state/dot-generator.test.ts
git commit -m "feat: add DOT graph generator with legend and escaping"
```

---

## Batch 3: MCP Tool Handlers (start, propose, commit)

**Goal:** Implement the first three MCP tools that handle investigation lifecycle and batch submission.

### Task 3.1: tot_start Tool

**Files:**
- Create: `src/tools/start.ts`
- Test: `src/tools/start.test.ts`

**Step 1: Write the failing test**

```typescript
// src/tools/start.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { handleStart, startInputSchema } from "./start";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("tot_start", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("creates new investigation with query", async () => {
    const result = await handleStart(
      { query: "Test investigation", minRoots: 5 },
      TEST_DIR
    );

    expect(result.sessionId).toBeDefined();
    expect(result.query).toBe("Test investigation");
    expect(result.minRoots).toBe(5);
    expect(result.currentRound).toBe(1);
    expect(result.instructions).toContain("propose");
  });

  test("uses default minRoots of 5", async () => {
    const result = await handleStart(
      { query: "Test" },
      TEST_DIR
    );

    expect(result.minRoots).toBe(5);
  });

  test("allows custom minRoots", async () => {
    const result = await handleStart(
      { query: "Test", minRoots: 3 },
      TEST_DIR
    );

    expect(result.minRoots).toBe(3);
  });

  test("persists investigation to file", async () => {
    const result = await handleStart(
      { query: "Persist test" },
      TEST_DIR
    );

    const filePath = `${TEST_DIR}/${result.sessionId}.json`;
    expect(existsSync(filePath)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/tools/start.test.ts
```
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/tools/start.ts
import { z } from "zod";
import { InvestigationState } from "../state/investigation";

export const startInputSchema = z.object({
  query: z.string().describe("The investigation query/problem to solve"),
  minRoots: z
    .number()
    .min(1)
    .default(5)
    .describe("Minimum number of root nodes in Round 1 (default: 5)"),
});

export type StartInput = z.infer<typeof startInputSchema>;

export interface StartResult {
  sessionId: string;
  query: string;
  minRoots: number;
  currentRound: number;
  instructions: string;
}

export async function handleStart(
  input: StartInput,
  persistDir: string = "./investigations"
): Promise<StartResult> {
  const query = input.query;
  const minRoots = input.minRoots ?? 5;

  const state = InvestigationState.create(query, minRoots, persistDir);
  state.save();

  return {
    sessionId: state.data.sessionId,
    query: state.data.query,
    minRoots: state.data.minRoots,
    currentRound: state.data.currentRound,
    instructions: `Investigation started. You must now:
1. Call tot_propose with ${minRoots} root nodes (R1.A, R1.B, R1.C, ...)
2. Each root node needs: id, parent (null for roots), title, plannedAction
3. After propose succeeds, spawn your agents
4. Call tot_commit with results when agents complete

Rules:
- Maximum 5 nodes per batch
- DRILL nodes require >= 2 children
- VERIFY nodes require >= 1 child
- DEAD/VALID/SPEC are terminal (no children)
- Minimum 3 rounds before ending`,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/tools/start.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/start.ts src/tools/start.test.ts
git commit -m "feat: add tot_start tool handler"
```

---

### Task 3.2: tot_propose Tool

**Files:**
- Create: `src/tools/propose.ts`
- Test: `src/tools/propose.test.ts`

**Step 1: Write the failing test**

```typescript
// src/tools/propose.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { handlePropose } from "./propose";
import { handleStart } from "./start";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("tot_propose", () => {
  let sessionId: string;

  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    const startResult = await handleStart({ query: "Test", minRoots: 3 }, TEST_DIR);
    sessionId = startResult.sessionId;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("accepts valid batch of root nodes", async () => {
    const result = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R1.A", parent: null, title: "Node A", plannedAction: "Do A" },
          { id: "R1.B", parent: null, title: "Node B", plannedAction: "Do B" },
          { id: "R1.C", parent: null, title: "Node C", plannedAction: "Do C" },
        ],
      },
      TEST_DIR
    );

    expect(result.status).toBe("OK");
    expect(result.errors).toHaveLength(0);
  });

  test("rejects batch with more than 5 nodes", async () => {
    const result = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R1.A", parent: null, title: "A", plannedAction: "A" },
          { id: "R1.B", parent: null, title: "B", plannedAction: "B" },
          { id: "R1.C", parent: null, title: "C", plannedAction: "C" },
          { id: "R1.D", parent: null, title: "D", plannedAction: "D" },
          { id: "R1.E", parent: null, title: "E", plannedAction: "E" },
          { id: "R1.F", parent: null, title: "F", plannedAction: "F" },
        ],
      },
      TEST_DIR
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errors.some((e) => e.error === "BATCH_OVERFLOW")).toBe(true);
  });

  test("rejects node with non-existent parent", async () => {
    const result = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "Child", plannedAction: "Do" },
        ],
      },
      TEST_DIR
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errors[0].error).toBe("PARENT_NOT_FOUND");
  });

  test("rejects invalid session ID", async () => {
    const result = await handlePropose(
      {
        sessionId: "invalid-session",
        nodes: [
          { id: "R1.A", parent: null, title: "Test", plannedAction: "Do" },
        ],
      },
      TEST_DIR
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errors[0].error).toBe("SESSION_NOT_FOUND");
  });

  test("returns approved node list on success", async () => {
    const result = await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R1.A", parent: null, title: "Node A", plannedAction: "Do A" },
        ],
      },
      TEST_DIR
    );

    expect(result.approvedNodes).toContain("R1.A");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/tools/propose.test.ts
```
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/tools/propose.ts
import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator } from "../state/validation";
import type { ProposedNode, ValidationError } from "../types";

export const proposeInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  nodes: z
    .array(
      z.object({
        id: z.string().describe("Node ID in format R[round].[id]"),
        parent: z.string().nullable().describe("Parent node ID or null for roots"),
        title: z.string().describe("Short title describing this node's focus"),
        plannedAction: z.string().describe("What the agent will investigate"),
      })
    )
    .describe("Array of proposed nodes (max 5)"),
});

export type ProposeInput = z.infer<typeof proposeInputSchema>;

export interface ProposeResult {
  status: "OK" | "REJECTED";
  errors: ValidationError[];
  approvedNodes: string[];
  message: string;
}

export async function handlePropose(
  input: ProposeInput,
  persistDir: string = "./investigations"
): Promise<ProposeResult> {
  // Load investigation
  const state = InvestigationState.load(input.sessionId, persistDir);

  if (!state) {
    return {
      status: "REJECTED",
      errors: [
        {
          nodeId: "SESSION",
          error: "SESSION_NOT_FOUND",
          message: `Investigation ${input.sessionId} not found`,
          suggestion: "Call tot_start first to create an investigation",
        },
      ],
      approvedNodes: [],
      message: "Session not found",
    };
  }

  const proposed: ProposedNode[] = input.nodes.map((n) => ({
    id: n.id,
    parent: n.parent,
    title: n.title,
    plannedAction: n.plannedAction,
  }));

  // Validate batch
  const errors = Validator.validateProposedBatch(proposed, state);

  // Check min roots for round 1
  const rootNodes = proposed.filter((n) => n.parent === null);
  if (state.data.currentRound === 1 && rootNodes.length > 0) {
    errors.push(...Validator.validateMinRoots(state, rootNodes.length));
  }

  if (errors.length > 0) {
    return {
      status: "REJECTED",
      errors,
      approvedNodes: [],
      message: `Validation failed with ${errors.length} error(s)`,
    };
  }

  return {
    status: "OK",
    errors: [],
    approvedNodes: proposed.map((n) => n.id),
    message: `Batch approved. Spawn agents for: ${proposed.map((n) => n.id).join(", ")}. Then call tot_commit with results.`,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/tools/propose.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/propose.ts src/tools/propose.test.ts
git commit -m "feat: add tot_propose tool with batch validation"
```

---

### Task 3.3: tot_commit Tool

**Files:**
- Create: `src/tools/commit.ts`
- Test: `src/tools/commit.test.ts`

**Step 1: Write the failing test**

```typescript
// src/tools/commit.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { handleCommit } from "./commit";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { NodeState } from "../types";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("tot_commit", () => {
  let sessionId: string;

  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    const startResult = await handleStart({ query: "Test", minRoots: 2 }, TEST_DIR);
    sessionId = startResult.sessionId;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("commits valid results and updates state", async () => {
    // First propose
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R1.A", parent: null, title: "Node A", plannedAction: "Do A" },
          { id: "R1.B", parent: null, title: "Node B", plannedAction: "Do B" },
        ],
      },
      TEST_DIR
    );

    // Then commit
    const result = await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R1.A", state: NodeState.DRILL, findings: "Found something" },
          { nodeId: "R1.B", state: NodeState.DEAD, findings: "Dead end" },
        ],
      },
      TEST_DIR
    );

    expect(result.status).toBe("OK");
    expect(result.dot).toContain("R1_A");
    expect(result.dot).toContain("lightblue"); // DRILL color
  });

  test("returns queue status after commit", async () => {
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
          { nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" },
          { nodeId: "R1.B", state: NodeState.DRILL, findings: "Lead" },
        ],
      },
      TEST_DIR
    );

    // 2 DRILL nodes = 4 children needed in next round
    expect(result.nextRoundInfo.nodesRequired).toBe(4);
    expect(result.nextRoundInfo.round).toBe(2);
  });

  test("calculates batch info correctly", async () => {
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
          { nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" },
          { nodeId: "R1.B", state: NodeState.DRILL, findings: "Lead" },
        ],
      },
      TEST_DIR
    );

    // 4 nodes needed, 5 per batch = 1 batch
    expect(result.nextRoundInfo.totalBatches).toBe(1);
  });

  test("rejects invalid session", async () => {
    const result = await handleCommit(
      {
        sessionId: "invalid",
        results: [],
      },
      TEST_DIR
    );

    expect(result.status).toBe("REJECTED");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/tools/commit.test.ts
```
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/tools/commit.ts
import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { DotGenerator } from "../state/dot-generator";
import { NodeState, getRequiredChildren, isTerminalState, type ValidationError } from "../types";

export const commitInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  results: z
    .array(
      z.object({
        nodeId: z.string().describe("The node ID that was executed"),
        state: z.nativeEnum(NodeState).describe("The resulting state"),
        findings: z.string().describe("What the agent discovered"),
      })
    )
    .describe("Results from executed agents"),
});

export type CommitInput = z.infer<typeof commitInputSchema>;

export interface CommitResult {
  status: "OK" | "REJECTED";
  errors: ValidationError[];
  dot: string;
  currentRound: number;
  batchComplete: boolean;
  roundComplete: boolean;
  nextRoundInfo: {
    round: number;
    nodesRequired: number;
    totalBatches: number;
    parentBreakdown: Array<{ parentId: string; state: string; childrenNeeded: number }>;
  };
  message: string;
}

export async function handleCommit(
  input: CommitInput,
  persistDir: string = "./investigations"
): Promise<CommitResult> {
  const state = InvestigationState.load(input.sessionId, persistDir);

  if (!state) {
    return {
      status: "REJECTED",
      errors: [
        {
          nodeId: "SESSION",
          error: "SESSION_NOT_FOUND",
          message: `Investigation ${input.sessionId} not found`,
        },
      ],
      dot: "",
      currentRound: 0,
      batchComplete: false,
      roundComplete: false,
      nextRoundInfo: { round: 0, nodesRequired: 0, totalBatches: 0, parentBreakdown: [] },
      message: "Session not found",
    };
  }

  const errors: ValidationError[] = [];

  // Add nodes to state
  for (const result of input.results) {
    // Find the proposed node info (we need parent from propose phase)
    // For now, extract round from ID
    const roundMatch = result.nodeId.match(/^R(\d+)\./);
    const round = roundMatch ? parseInt(roundMatch[1], 10) : state.data.currentRound;

    // Determine parent from ID pattern
    let parent: string | null = null;
    if (round > 1) {
      // Extract parent ID from hierarchical naming
      // R2.A1 -> parent is R1.A
      // R3.A1a -> parent is R2.A1
      const idParts = result.nodeId.split(".");
      if (idParts.length === 2) {
        const suffix = idParts[1];
        // Remove last character(s) to get parent suffix
        const parentSuffix = suffix.slice(0, -1);
        if (parentSuffix.length > 0) {
          parent = `R${round - 1}.${parentSuffix}`;
        }
      }
    }

    state.addNode({
      id: result.nodeId,
      parent,
      state: result.state,
      title: result.nodeId, // Will be updated with actual title
      findings: result.findings,
      children: [],
      round,
    });
  }

  // Calculate next round requirements
  const currentRoundNodes = state.getNodesByRound(state.data.currentRound);
  const parentBreakdown: Array<{ parentId: string; state: string; childrenNeeded: number }> = [];
  let nodesRequired = 0;

  for (const node of currentRoundNodes) {
    if (!isTerminalState(node.state)) {
      const needed = getRequiredChildren(node.state);
      const existing = node.children.length;
      const remaining = Math.max(0, needed - existing);

      if (remaining > 0) {
        parentBreakdown.push({
          parentId: node.id,
          state: node.state,
          childrenNeeded: remaining,
        });
        nodesRequired += remaining;
      }
    }
  }

  // Check if current round is complete
  const roundComplete = nodesRequired === 0 || parentBreakdown.length === 0;

  // Update state
  state.data.currentBatch += 1;
  if (roundComplete && currentRoundNodes.length > 0) {
    state.data.currentRound += 1;
    state.data.currentBatch = 0;
  }

  state.save();

  const dot = DotGenerator.generate(state);
  const totalBatches = Math.ceil(nodesRequired / 5);

  return {
    status: "OK",
    errors,
    dot,
    currentRound: state.data.currentRound,
    batchComplete: true,
    roundComplete,
    nextRoundInfo: {
      round: roundComplete ? state.data.currentRound : state.data.currentRound,
      nodesRequired,
      totalBatches,
      parentBreakdown,
    },
    message: roundComplete
      ? `Round ${state.data.currentRound - 1} complete. Next round requires ${nodesRequired} nodes in ${totalBatches} batch(es).`
      : `Batch complete. ${nodesRequired} nodes still needed for round ${state.data.currentRound}.`,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/tools/commit.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/commit.ts src/tools/commit.test.ts
git commit -m "feat: add tot_commit tool with queue calculation"
```

---

## Batch 4: Remaining Tools (reclassify, status, end)

**Goal:** Complete the remaining three tools for state modification, querying, and investigation finalization.

### Task 4.1: tot_reclassify Tool

**Files:**
- Create: `src/tools/reclassify.ts`
- Test: `src/tools/reclassify.test.ts`

**Step 1: Write the failing test**

```typescript
// src/tools/reclassify.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { handleReclassify } from "./reclassify";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { handleCommit } from "./commit";
import { NodeState } from "../types";
import { InvestigationState } from "../state/investigation";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("tot_reclassify", () => {
  let sessionId: string;

  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    const startResult = await handleStart({ query: "Test", minRoots: 2 }, TEST_DIR);
    sessionId = startResult.sessionId;

    // Set up initial nodes
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
          { nodeId: "R1.A", state: NodeState.DEAD, findings: "Dead" },
          { nodeId: "R1.B", state: NodeState.VALID, findings: "Valid" },
        ],
      },
      TEST_DIR
    );
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("reclassifies terminal node to active", async () => {
    const result = await handleReclassify(
      {
        sessionId,
        nodeId: "R1.A",
        newState: NodeState.DRILL,
      },
      TEST_DIR
    );

    expect(result.status).toBe("OK");
    expect(result.previousState).toBe(NodeState.DEAD);
    expect(result.newState).toBe(NodeState.DRILL);
  });

  test("rejects reclassification of node with children to terminal", async () => {
    // First reclassify to DRILL
    await handleReclassify(
      { sessionId, nodeId: "R1.A", newState: NodeState.DRILL },
      TEST_DIR
    );

    // Add a child
    await handlePropose(
      {
        sessionId,
        nodes: [{ id: "R2.A1", parent: "R1.A", title: "Child", plannedAction: "Do" }],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R2.A1", state: NodeState.DEAD, findings: "Dead" }],
      },
      TEST_DIR
    );

    // Try to reclassify parent to terminal
    const result = await handleReclassify(
      { sessionId, nodeId: "R1.A", newState: NodeState.DEAD },
      TEST_DIR
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errors[0].error).toBe("HAS_CHILDREN");
  });

  test("updates DOT graph after reclassification", async () => {
    const result = await handleReclassify(
      { sessionId, nodeId: "R1.A", newState: NodeState.DRILL },
      TEST_DIR
    );

    expect(result.dot).toContain("lightblue"); // DRILL color
  });

  test("rejects non-existent node", async () => {
    const result = await handleReclassify(
      { sessionId, nodeId: "R99.Z", newState: NodeState.DRILL },
      TEST_DIR
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errors[0].error).toBe("NODE_NOT_FOUND");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/tools/reclassify.test.ts
```
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/tools/reclassify.ts
import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator } from "../state/validation";
import { DotGenerator } from "../state/dot-generator";
import { NodeState, type ValidationError } from "../types";

export const reclassifyInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
  nodeId: z.string().describe("The node ID to reclassify"),
  newState: z.nativeEnum(NodeState).describe("The new state for the node"),
});

export type ReclassifyInput = z.infer<typeof reclassifyInputSchema>;

export interface ReclassifyResult {
  status: "OK" | "REJECTED";
  errors: ValidationError[];
  nodeId: string;
  previousState: NodeState | null;
  newState: NodeState;
  dot: string;
  message: string;
}

export async function handleReclassify(
  input: ReclassifyInput,
  persistDir: string = "./investigations"
): Promise<ReclassifyResult> {
  const state = InvestigationState.load(input.sessionId, persistDir);

  if (!state) {
    return {
      status: "REJECTED",
      errors: [
        {
          nodeId: "SESSION",
          error: "SESSION_NOT_FOUND",
          message: `Investigation ${input.sessionId} not found`,
        },
      ],
      nodeId: input.nodeId,
      previousState: null,
      newState: input.newState,
      dot: "",
      message: "Session not found",
    };
  }

  const node = state.getNode(input.nodeId);
  if (!node) {
    return {
      status: "REJECTED",
      errors: [
        {
          nodeId: input.nodeId,
          error: "NODE_NOT_FOUND",
          message: `Node ${input.nodeId} does not exist`,
        },
      ],
      nodeId: input.nodeId,
      previousState: null,
      newState: input.newState,
      dot: DotGenerator.generate(state),
      message: "Node not found",
    };
  }

  const errors = Validator.validateReclassification(input.nodeId, input.newState, state);

  if (errors.length > 0) {
    return {
      status: "REJECTED",
      errors,
      nodeId: input.nodeId,
      previousState: node.state,
      newState: input.newState,
      dot: DotGenerator.generate(state),
      message: `Cannot reclassify: ${errors.map((e) => e.message).join("; ")}`,
    };
  }

  const previousState = node.state;
  state.updateNode(input.nodeId, { state: input.newState });
  state.save();

  return {
    status: "OK",
    errors: [],
    nodeId: input.nodeId,
    previousState,
    newState: input.newState,
    dot: DotGenerator.generate(state),
    message: `Node ${input.nodeId} reclassified from ${previousState} to ${input.newState}`,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/tools/reclassify.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/reclassify.ts src/tools/reclassify.test.ts
git commit -m "feat: add tot_reclassify tool for state changes"
```

---

### Task 4.2: tot_status Tool

**Files:**
- Create: `src/tools/status.ts`
- Test: `src/tools/status.test.ts`

**Step 1: Write the failing test**

```typescript
// src/tools/status.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { handleStatus } from "./status";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { handleCommit } from "./commit";
import { NodeState } from "../types";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("tot_status", () => {
  let sessionId: string;

  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    const startResult = await handleStart({ query: "Test", minRoots: 2 }, TEST_DIR);
    sessionId = startResult.sessionId;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("returns status for new investigation", async () => {
    const result = await handleStatus({ sessionId }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.currentRound).toBe(1);
    expect(result.totalNodes).toBe(0);
  });

  test("returns node counts after commits", async () => {
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
          { nodeId: "R1.B", state: NodeState.DEAD, findings: "Dead" },
        ],
      },
      TEST_DIR
    );

    const result = await handleStatus({ sessionId }, TEST_DIR);

    expect(result.totalNodes).toBe(2);
    expect(result.activeDrills).toBe(1);
    expect(result.terminalNodes).toBe(1);
  });

  test("includes DOT graph", async () => {
    await handlePropose(
      {
        sessionId,
        nodes: [{ id: "R1.A", parent: null, title: "A", plannedAction: "A" }],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [{ nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" }],
      },
      TEST_DIR
    );

    const result = await handleStatus({ sessionId }, TEST_DIR);

    expect(result.dot).toContain("digraph");
    expect(result.dot).toContain("R1_A");
  });

  test("shows canEnd status", async () => {
    const result = await handleStatus({ sessionId }, TEST_DIR);

    expect(result.canEnd).toBe(false);
    expect(result.endBlocker).toBeDefined();
  });

  test("rejects invalid session", async () => {
    const result = await handleStatus({ sessionId: "invalid" }, TEST_DIR);

    expect(result.status).toBe("REJECTED");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/tools/status.test.ts
```
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/tools/status.ts
import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator } from "../state/validation";
import { DotGenerator } from "../state/dot-generator";
import { NodeState, isTerminalState, getRequiredChildren } from "../types";

export const statusInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
});

export type StatusInput = z.infer<typeof statusInputSchema>;

export interface StatusResult {
  status: "OK" | "REJECTED";
  sessionId: string;
  query: string;
  currentRound: number;
  currentBatch: number;
  totalNodes: number;
  activeDrills: number;
  activeVerifies: number;
  terminalNodes: number;
  nodesInQueue: number;
  canEnd: boolean;
  endBlocker?: string;
  dot: string;
  nextActions: string[];
}

export async function handleStatus(
  input: StatusInput,
  persistDir: string = "./investigations"
): Promise<StatusResult> {
  const state = InvestigationState.load(input.sessionId, persistDir);

  if (!state) {
    return {
      status: "REJECTED",
      sessionId: input.sessionId,
      query: "",
      currentRound: 0,
      currentBatch: 0,
      totalNodes: 0,
      activeDrills: 0,
      activeVerifies: 0,
      terminalNodes: 0,
      nodesInQueue: 0,
      canEnd: false,
      endBlocker: "Session not found",
      dot: "",
      nextActions: ["Call tot_start to create a new investigation"],
    };
  }

  const allNodes = state.getAllNodes();
  const drillNodes = allNodes.filter((n) => n.state === NodeState.DRILL);
  const verifyNodes = allNodes.filter((n) => n.state === NodeState.VERIFY);
  const terminalNodes = allNodes.filter((n) => isTerminalState(n.state));

  // Calculate queue
  let nodesInQueue = 0;
  for (const node of [...drillNodes, ...verifyNodes]) {
    const required = getRequiredChildren(node.state);
    const existing = node.children.length;
    nodesInQueue += Math.max(0, required - existing);
  }

  const canEndResult = Validator.canEndInvestigation(state);

  const nextActions: string[] = [];
  if (nodesInQueue > 0) {
    nextActions.push(`Call tot_propose to add ${nodesInQueue} child node(s)`);
  } else if (!canEndResult.canEnd) {
    nextActions.push(canEndResult.reason || "Continue investigation");
  } else {
    nextActions.push("Call tot_end to finalize the investigation");
  }

  return {
    status: "OK",
    sessionId: state.data.sessionId,
    query: state.data.query,
    currentRound: state.data.currentRound,
    currentBatch: state.data.currentBatch,
    totalNodes: allNodes.length,
    activeDrills: drillNodes.length,
    activeVerifies: verifyNodes.length,
    terminalNodes: terminalNodes.length,
    nodesInQueue,
    canEnd: canEndResult.canEnd,
    endBlocker: canEndResult.reason,
    dot: DotGenerator.generate(state),
    nextActions,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/tools/status.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/status.ts src/tools/status.test.ts
git commit -m "feat: add tot_status tool for investigation overview"
```

---

### Task 4.3: tot_end Tool

**Files:**
- Create: `src/tools/end.ts`
- Test: `src/tools/end.test.ts`

**Step 1: Write the failing test**

```typescript
// src/tools/end.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { handleEnd } from "./end";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { handleCommit } from "./commit";
import { NodeState } from "../types";
import { existsSync, rmSync } from "fs";

const TEST_DIR = "./test-investigations";

describe("tot_end", () => {
  let sessionId: string;

  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    const startResult = await handleStart({ query: "Test", minRoots: 1 }, TEST_DIR);
    sessionId = startResult.sessionId;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("rejects end before round 3", async () => {
    await handlePropose(
      { sessionId, nodes: [{ id: "R1.A", parent: null, title: "A", plannedAction: "A" }] },
      TEST_DIR
    );
    await handleCommit(
      { sessionId, results: [{ nodeId: "R1.A", state: NodeState.VALID, findings: "Done" }] },
      TEST_DIR
    );

    const result = await handleEnd({ sessionId }, TEST_DIR);

    expect(result.status).toBe("REJECTED");
    expect(result.reason).toContain("RECOVERY_REQUIRED");
  });

  test("allows end after round 3 with all terminal nodes", async () => {
    // Simulate reaching round 3 with terminal nodes
    // Round 1
    await handlePropose(
      { sessionId, nodes: [{ id: "R1.A", parent: null, title: "A", plannedAction: "A" }] },
      TEST_DIR
    );
    await handleCommit(
      { sessionId, results: [{ nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" }] },
      TEST_DIR
    );

    // Round 2
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "A1", plannedAction: "A1" },
          { id: "R2.A2", parent: "R1.A", title: "A2", plannedAction: "A2" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.DRILL, findings: "Lead" },
          { nodeId: "R2.A2", state: NodeState.DEAD, findings: "Dead" },
        ],
      },
      TEST_DIR
    );

    // Round 3
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "A1a", plannedAction: "A1a" },
          { id: "R3.A1b", parent: "R2.A1", title: "A1b", plannedAction: "A1b" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.VALID, findings: "Solution!" },
          { nodeId: "R3.A1b", state: NodeState.DEAD, findings: "Dead" },
        ],
      },
      TEST_DIR
    );

    const result = await handleEnd({ sessionId }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.finalDot).toContain("digraph");
    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0].nodeId).toBe("R3.A1a");
  });

  test("returns summary with solutions and theories", async () => {
    // Build a 3-round investigation with VALID and SPEC results
    await handlePropose(
      { sessionId, nodes: [{ id: "R1.A", parent: null, title: "A", plannedAction: "A" }] },
      TEST_DIR
    );
    await handleCommit(
      { sessionId, results: [{ nodeId: "R1.A", state: NodeState.DRILL, findings: "Lead" }] },
      TEST_DIR
    );

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "A1", plannedAction: "A1" },
          { id: "R2.A2", parent: "R1.A", title: "A2", plannedAction: "A2" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.DRILL, findings: "More" },
          { nodeId: "R2.A2", state: NodeState.SPEC, findings: "Theory" },
        ],
      },
      TEST_DIR
    );

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "A1a", plannedAction: "A1a" },
          { id: "R3.A1b", parent: "R2.A1", title: "A1b", plannedAction: "A1b" },
        ],
      },
      TEST_DIR
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.VALID, findings: "Found it" },
          { nodeId: "R3.A1b", state: NodeState.DEAD, findings: "Nope" },
        ],
      },
      TEST_DIR
    );

    const result = await handleEnd({ sessionId }, TEST_DIR);

    expect(result.solutions).toHaveLength(1);
    expect(result.theories).toHaveLength(1);
    expect(result.theories[0].nodeId).toBe("R2.A2");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/tools/end.test.ts
```
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/tools/end.ts
import { z } from "zod";
import { InvestigationState } from "../state/investigation";
import { Validator } from "../state/validation";
import { DotGenerator } from "../state/dot-generator";
import { NodeState } from "../types";

export const endInputSchema = z.object({
  sessionId: z.string().describe("The investigation session ID"),
});

export type EndInput = z.infer<typeof endInputSchema>;

export interface NodeSummary {
  nodeId: string;
  title: string;
  findings: string;
  round: number;
}

export interface EndResult {
  status: "OK" | "REJECTED";
  reason?: string;
  sessionId: string;
  query: string;
  totalRounds: number;
  totalNodes: number;
  finalDot: string;
  solutions: NodeSummary[];
  theories: NodeSummary[];
  deadEnds: number;
}

export async function handleEnd(
  input: EndInput,
  persistDir: string = "./investigations"
): Promise<EndResult> {
  const state = InvestigationState.load(input.sessionId, persistDir);

  if (!state) {
    return {
      status: "REJECTED",
      reason: "Session not found",
      sessionId: input.sessionId,
      query: "",
      totalRounds: 0,
      totalNodes: 0,
      finalDot: "",
      solutions: [],
      theories: [],
      deadEnds: 0,
    };
  }

  const canEndResult = Validator.canEndInvestigation(state);

  if (!canEndResult.canEnd) {
    return {
      status: "REJECTED",
      reason: canEndResult.reason,
      sessionId: state.data.sessionId,
      query: state.data.query,
      totalRounds: state.data.currentRound,
      totalNodes: state.getAllNodes().length,
      finalDot: DotGenerator.generate(state),
      solutions: [],
      theories: [],
      deadEnds: 0,
    };
  }

  const allNodes = state.getAllNodes();

  const solutions: NodeSummary[] = allNodes
    .filter((n) => n.state === NodeState.VALID)
    .map((n) => ({
      nodeId: n.id,
      title: n.title,
      findings: n.findings || "",
      round: n.round,
    }));

  const theories: NodeSummary[] = allNodes
    .filter((n) => n.state === NodeState.SPEC)
    .map((n) => ({
      nodeId: n.id,
      title: n.title,
      findings: n.findings || "",
      round: n.round,
    }));

  const deadEnds = allNodes.filter((n) => n.state === NodeState.DEAD).length;

  return {
    status: "OK",
    sessionId: state.data.sessionId,
    query: state.data.query,
    totalRounds: state.data.currentRound,
    totalNodes: allNodes.length,
    finalDot: DotGenerator.generate(state),
    solutions,
    theories,
    deadEnds,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/tools/end.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/end.ts src/tools/end.test.ts
git commit -m "feat: add tot_end tool with final report generation"
```

---

## Batch 5: MCP Server Integration + Entry Point

**Goal:** Wire all tools into the MCP server and create the entry point.

### Task 5.1: Tool Index Export

**Files:**
- Create: `src/tools/index.ts`

**Step 1: Create barrel export**

```typescript
// src/tools/index.ts
export { handleStart, startInputSchema, type StartInput, type StartResult } from "./start";
export { handlePropose, proposeInputSchema, type ProposeInput, type ProposeResult } from "./propose";
export { handleCommit, commitInputSchema, type CommitInput, type CommitResult } from "./commit";
export { handleReclassify, reclassifyInputSchema, type ReclassifyInput, type ReclassifyResult } from "./reclassify";
export { handleStatus, statusInputSchema, type StatusInput, type StatusResult } from "./status";
export { handleEnd, endInputSchema, type EndInput, type EndResult } from "./end";
```

**Step 2: Commit**

```bash
git add src/tools/index.ts
git commit -m "chore: add tool barrel export"
```

---

### Task 5.2: MCP Server Entry Point

**Files:**
- Create: `src/index.ts`
- Test: Manual testing via stdio

**Step 1: Write implementation**

```typescript
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NodeState } from "./types";
import {
  handleStart,
  handlePropose,
  handleCommit,
  handleReclassify,
  handleStatus,
  handleEnd,
} from "./tools";

const PERSIST_DIR = "./investigations";

const server = new McpServer({
  name: "tree-of-thoughts",
  version: "1.0.0",
});

// tot_start - Begin investigation
server.registerTool(
  "tot_start",
  {
    title: "Start Investigation",
    description:
      "Start a new Tree of Thoughts investigation. Returns session ID and instructions.",
    inputSchema: {
      query: z.string().describe("The problem/question to investigate"),
      minRoots: z
        .number()
        .min(1)
        .optional()
        .describe("Minimum root nodes in Round 1 (default: 5)"),
    },
  },
  async (input) => {
    const result = await handleStart(
      { query: input.query, minRoots: input.minRoots ?? 5 },
      PERSIST_DIR
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// tot_propose - Validate batch before execution
server.registerTool(
  "tot_propose",
  {
    title: "Propose Batch",
    description:
      "Validate a batch of nodes before spawning agents. Returns OK or REJECTED with errors.",
    inputSchema: {
      sessionId: z.string().describe("The investigation session ID"),
      nodes: z
        .array(
          z.object({
            id: z.string().describe("Node ID (format: R[round].[id])"),
            parent: z.string().nullable().describe("Parent node ID or null"),
            title: z.string().describe("Short title for this node"),
            plannedAction: z.string().describe("What the agent will do"),
          })
        )
        .describe("Nodes to propose (max 5)"),
    },
  },
  async (input) => {
    const result = await handlePropose(
      {
        sessionId: input.sessionId,
        nodes: input.nodes,
      },
      PERSIST_DIR
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// tot_commit - Submit agent results
server.registerTool(
  "tot_commit",
  {
    title: "Commit Results",
    description:
      "Submit completed agent results. Returns updated graph and next round requirements.",
    inputSchema: {
      sessionId: z.string().describe("The investigation session ID"),
      results: z
        .array(
          z.object({
            nodeId: z.string().describe("The node ID"),
            state: z.enum(["DRILL", "VERIFY", "DEAD", "VALID", "SPEC"]).describe("Result state"),
            findings: z.string().describe("What was discovered"),
          })
        )
        .describe("Results from executed agents"),
    },
  },
  async (input) => {
    const results = input.results.map((r) => ({
      nodeId: r.nodeId,
      state: r.state as NodeState,
      findings: r.findings,
    }));
    const result = await handleCommit(
      { sessionId: input.sessionId, results },
      PERSIST_DIR
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// tot_reclassify - Change node state
server.registerTool(
  "tot_reclassify",
  {
    title: "Reclassify Node",
    description:
      "Change a node's state. Use to revive terminal nodes or correct misclassifications.",
    inputSchema: {
      sessionId: z.string().describe("The investigation session ID"),
      nodeId: z.string().describe("The node ID to reclassify"),
      newState: z.enum(["DRILL", "VERIFY", "DEAD", "VALID", "SPEC"]).describe("New state"),
    },
  },
  async (input) => {
    const result = await handleReclassify(
      {
        sessionId: input.sessionId,
        nodeId: input.nodeId,
        newState: input.newState as NodeState,
      },
      PERSIST_DIR
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// tot_status - Get current state
server.registerTool(
  "tot_status",
  {
    title: "Get Status",
    description:
      "Get current investigation status including graph, queue, and next actions.",
    inputSchema: {
      sessionId: z.string().describe("The investigation session ID"),
    },
  },
  async (input) => {
    const result = await handleStatus({ sessionId: input.sessionId }, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// tot_end - Finalize investigation
server.registerTool(
  "tot_end",
  {
    title: "End Investigation",
    description:
      "Finalize the investigation. Returns final graph, solutions, and theories.",
    inputSchema: {
      sessionId: z.string().describe("The investigation session ID"),
    },
  },
  async (input) => {
    const result = await handleEnd({ sessionId: input.sessionId }, PERSIST_DIR);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("Tree of Thoughts MCP Server running on stdio");
```

**Step 2: Run tests**

```bash
bun test
```
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add MCP server entry point with all tools"
```

---

### Task 5.3: State Index Export + Final Cleanup

**Files:**
- Create: `src/state/index.ts`
- Update: `package.json` with bin entry

**Step 1: Create state barrel export**

```typescript
// src/state/index.ts
export { InvestigationState } from "./investigation";
export { Validator } from "./validation";
export { DotGenerator } from "./dot-generator";
```

**Step 2: Update package.json**

Add to package.json:
```json
{
  "bin": {
    "tree-of-thoughts-mcp": "./src/index.ts"
  }
}
```

**Step 3: Run full test suite**

```bash
bun test
```
Expected: All tests pass

**Step 4: Final commit**

```bash
git add src/state/index.ts package.json
git commit -m "chore: final cleanup and bin entry"
```

---

## Post-Implementation: Integration Testing

After all batches complete, test the full flow:

```bash
# Start the server
bun run src/index.ts

# In Claude Code config, add:
# {
#   "mcpServers": {
#     "tree-of-thoughts": {
#       "command": "bun",
#       "args": ["run", "/path/to/tree-of-thoughts-mcp/src/index.ts"]
#     }
#   }
# }
```

Test sequence:
1. `tot_start` with a query
2. `tot_propose` with 5 root nodes
3. `tot_commit` with results
4. Repeat propose/commit for rounds 2-3
5. `tot_end` to finalize

---

**Plan complete and saved to `docs/plans/2026-01-27-tree-of-thoughts-mcp.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per batch, review between batches, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
