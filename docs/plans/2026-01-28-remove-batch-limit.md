# Remove Batch Limit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan batch by batch.

**Goal:** Remove the 5-node batch limit - unlimited parallel subagents now supported.

**Architecture:** Delete BATCH_OVERFLOW validation, update schema descriptions, update all documentation. Simple removal - no new logic needed.

**Tech Stack:** TypeScript, Zod

---

## Batch 1: Remove Batch Limit from Code + Docs

**Goal:** Remove all batch limit references from validation, schemas, and documentation.

### Task 1.1: Remove BATCH_OVERFLOW Validation

**Files:**
- Modify: `src/state/validation.ts`

**Step 1: Find and remove BATCH_OVERFLOW check**

Remove the batch size validation (around line 50-60). Search for `BATCH_OVERFLOW` and delete that validation block.

**Step 2: Run tests**

Run: `npm test`
Expected: PASS (no tests depend on batch limit)

**Step 3: Commit**

```bash
git add src/state/validation.ts
git commit -m "feat: remove 5-node batch limit from validation"
```

---

### Task 1.2: Update propose.ts Schema Description

**Files:**
- Modify: `src/tools/propose.ts`

**Step 1: Update schema description**

Change line 17 from:
```typescript
.describe("Array of proposed nodes (max 5)"),
```

To:
```typescript
.describe("Array of proposed nodes"),
```

Remove comment on line 55 about "max 5".

**Step 2: Commit**

```bash
git add src/tools/propose.ts
git commit -m "feat: remove batch limit from propose schema"
```

---

### Task 1.3: Update index.ts Schema

**Files:**
- Modify: `src/index.ts`

**Step 1: Update tool description and schema**

Change line 33 from:
```typescript
"Propose nodes (max 5). Returns OK or REJECTED.",
```

To:
```typescript
"Propose nodes for investigation. Returns OK or REJECTED.",
```

Change line 45 from:
```typescript
.describe("Nodes to propose (max 5)"),
```

To:
```typescript
.describe("Nodes to propose"),
```

**Step 2: Build and test**

Run: `npm run build && npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: remove batch limit from MCP schema"
```

---

### Task 1.4: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `skills/SKILL.md`

**Step 1: Update README.md**

Line 57 - Change:
```
2. tot_propose  → Declare nodes to investigate (max 5 per batch)
```
To:
```
2. tot_propose  → Declare nodes to investigate
```

Line 75 - Remove rule "1. **Max 5 nodes per batch**" and renumber remaining rules.

**Step 2: Update skills/SKILL.md**

Line 20 - Change:
```
2. tot_propose → declare nodes (max 5 per batch)
```
To:
```
2. tot_propose → declare nodes
```

Line 51 - Remove "1. Max 5 nodes per batch" and renumber remaining rules.

Line 118 - Remove the BATCH_OVERFLOW row from the Errors table.

**Step 3: Commit**

```bash
git add README.md skills/SKILL.md
git commit -m "docs: remove batch limit from documentation"
```

---

### Task 1.5: Update Local Skill Copy

**Files:**
- Modify: `~/.claude/skills/tree-of-thoughts/SKILL.md`

**Step 1: Apply same changes as Task 1.4**

Remove batch limit references from workflow, rules, and errors table.

**Step 2: Commit (in repo only)**

No commit needed - this is outside the repo.

---

## Verification

After all tasks:

```bash
npm test
npm run build
git push origin master
```

Expected: All tests pass, build succeeds, changes pushed to GitHub.
