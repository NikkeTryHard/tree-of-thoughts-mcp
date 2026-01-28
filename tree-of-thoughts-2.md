---
description: Recursive "Tree of Thoughts" investigation. Min 3 Rounds. Explicit Branching. Strict Topology.
---

# Ultimate Goal
Provide the highest accuracy answer and all alternatives to the user concern regardless of topic.

# 1. Core Taxonomy & Rules

## 1.1 The 5-State Taxonomy (CRITICAL)
You **MUST** classify every agent's result into exactly one of these 5 states.

| State | Color | Definition | Action (Strict) |
| :--- | :--- | :--- | :--- |
| **DRILL** | `lightblue` | **Intermediate Fact.** A verified fact that is *needed* for the next round. | **MUST** spawn sub-agents. |
| **VERIFY** | `purple` | **Ambiguity.** Conflicting data or assumption. | **MUST** spawn 1 verifier. |
| **DEAD** | `red` | **Failure.** Path irrelevant or false. | **STOP** (Terminal Node). |
| **VALID** | `green` | **FINAL ANSWER.** The investigation is complete. No further steps. | **STOP** (Terminal Node). |
| **SPEC** | `gold` | **Theory.** Plausible but unverifiable locally. | **STOP** (Terminal Node). |

**CRITICAL RULE:** If a node's finding is used to calculate/derive a node in the next round, it is **DRILL (Blue)**, not Valid. Green nodes are dead ends.

## 1.2 Topology Constraints (VIOLATIONS FORBIDDEN)

### 1.2.1 The "Green Wall" Rule
*   **BAD (Illegal):** `R2.1 [fillcolor=green] -> R3.1`
    *   *Why:* If R2.1 is Green, it is a Solution. Solutions do not have children.
*   **GOOD (Correct):** `R2.1 [fillcolor=lightblue] -> R3.1`
    *   *Why:* If you need to go deeper, R2.1 is an Intermediate Fact (Drill/Blue).

### 1.2.2 The "Single Parent" Rule
*   **BAD (Illegal):** `R1.1 -> R2.1` AND `R1.2 -> R2.1`
    *   *Why:* This is a Mesh, not a Tree. Do not merge branches.
*   **GOOD (Correct):** `R1.1 -> R2.1a` AND `R1.2 -> R2.1b`
    *   *Why:* Split the investigation into separate paths.

## 1.3 Operational Constraints
1.  **Min 3 Rounds:** Run at least 3 distinct waves of agents.
2.  **Min 5 Roots:** Start with at least 5 parallel agents.
3.  **Hybrid Tools:** Use `fast-webfetch` (Online) AND `fast_bash` (Offline) in every round.
4.  **No Consolidation:** Do not merge findings until the Final Output.
5.  **State Reporting:** Output a "Round Status" block after every batch.

# 2. The Logic Maps

## 2.1 Branching Logic (Per Result)
**Apply to EVERY agent result:**

```dot
digraph MicroLogic {
rankdir=LR;
node [shape=box];
Result -> Eval;
Eval -> Drill [label="Fact needed for next step -> Spawn Children"];
Eval -> Verify [label="Ambiguous -> Spawn 1 Child"];
Eval -> Dead [label="Irrelevant -> STOP"];
Eval -> Valid [label="Final Solution -> STOP"];
Eval -> Spec [label="Theory -> STOP"];
}
```

## 2.2 Lifecycle Logic (Global)
**Manage the swarm:**

```dot
digraph MacroFlow {
rankdir=TB;
node [shape=box];
Start_Gen1 -> Report_Status;
Report_Status -> Check_Active;
Check_Active -> Gen_N_Plus_1 [label="Active > 0"];
Check_Active -> Lateral_Roots [label="All Dead (Recovery)"];
Check_Active -> Final_Output [label="Round >= 3 AND Saturated"];
}
```

# 3. Execution Protocol

## 3.0 Naming & Batching Protocols (STRICT)
1.  **Node Naming:**
    Every node MUST use the format `R[Round].[ID]`.
    *   *Example:* `R1.1`, `R1.2` ... `R2.1`, `R2.2`.

2.  **The "Max 5" Batch Rule (Software Constraint):**
    You are limited to **5 Agents per output generation**.
    *   **IF** a round requires >5 agents (e.g., 8 leads found):
        1.  Run Agents 1-5.
        2.  Output "Status: Batch 1 Complete (Pending 3 more)".
        3.  **DO NOT** increment the Round Number.
        4.  Run Agents 6-8 in the next generation.
        5.  **ONLY** when all agents for the current round are finished, declare "Round X Complete."

## 3.1 ROUND 1: The Roots
*   **Goal:** Generate `DRILL` nodes (Leads).
*   **Action:** Spawn **MINIMUM 5 Hybrid Agents** on every aspect of the problem.
*   **Constraint:** Broad sweep. Do not guess the solution yet.

## 3.2 ROUND 2..N: The Recursion Loop
**Logic:**
1.  **Analyze Previous Results:** Apply Graph A (MicroLogic).
2.  **Review previous results:**
    *   **IF `DRILL`:** Spawn 2 sub-agents.
    *   **IF `VERIFY`:** Spawn 1 agent.
    *   **IF `DEAD` / `VALID` / `SPEC`:** **DO NOT SPAWN.** These are dead ends.
    *   **Constraint:** You cannot mark a node `VALID` unless you have run a test that confirms the fix works.

### Intermission: Round Status & Graph
**Output this block immediately after a Round (or Batch) finishes:**

> **1. Progress Report:**
> * **Current Round:** [N] (Batch [X] of [Y])
> * **Active Drills (Blue):** [Count] -> Spawning sub-agents...
> * **Verifications (Purple):** [Count] -> Spawning verifiers...
> * **Dead Ends (Red):** [List IDs]
>
> **2. Current Topology (DOT):**
> Generate the **Cumulative DOT Graph** showing the tree from R1 up to the current moment.
> * *Constraint:* Use the `R[N].[ID]` naming format.
> * *Constraint:* Ensure previous rounds are connected to current results.

## 3.3 Stop Condition
**Proceed to Final Output ONLY if:**
1.  Round Count >= 3.
2.  All branches are `Dead`, `Valid`, or `Spec`.
3.  **Recovery:** If all dead before Round 3, spawn **New Lateral Roots** immediately.

# 4. Final Deliverables

## 4.1 Visualization
**Requirement:** Synthesize the entire session into a **GraphViz/DOT** visualization.

**Visualization Rules:**
1.  **Naming:** Use the `R[Round].[ID]` format.
2.  **Strict Coloring:** Use the colors defined in the Taxonomy table.
3.  **Label Format:** `Round | Title \n (Trigger)`.
4.  **Flow:** Top-to-Bottom flow.

**Template:**
```dot
digraph Investigation {
  rankdir=TB;
  node [shape=box, style="filled,rounded", fontname="Arial"];

  // --- Round 1: The Roots ---
  R1_Root [fillcolor=lightblue, label="R1 | Initial Diagnostics\n(Trigger: User Report)"];

  // --- Round 2: First Branching ---
  // Path A: Dead End (Pruned immediately)
  R2_Dead [fillcolor=red, label="R2 | Network Scan\n(Trigger: Port 80 Check)"];
  
  // Path B: The Lead (Drill) - MUST Branch next
  R2_Lead [fillcolor=lightblue, label="R2 | Log Analysis\n(Trigger: Found 'Error 500')"];

  // --- Round 3: The Recursion (Branching from R2 Lead) ---
  // Sub-Agent 1: Checks Permissions (Turns out to be dead)
  R3_Sub1 [fillcolor=red, label="R3 | Check File Perms\n(Trigger: 'Access Denied' hint)"];
  
  // Sub-Agent 2: Verifies Syntax (The right path)
  R3_Sub2 [fillcolor=purple, label="R3 | Verify .htaccess\n(Trigger: Syntax Warning)"];

  // --- Round 4: Final Fix ---
  R4_Fix  [fillcolor=green, label="R4 | Apply Syntax Fix\n(Trigger: Test Script Passed)"];

  // --- Connections ---
  // R1 splits into multiple angles
  R1_Root -> R2_Dead;
  R1_Root -> R2_Lead;

  // R2 (Drill) MUST split into sub-agents
  R2_Lead -> R3_Sub1;
  R2_Lead -> R3_Sub2;

  // R3 (Verify) leads to Success
  R3_Sub2 -> R4_Fix;
  
  // --- Legend ---
  subgraph cluster_legend {
      label="Taxonomy";
      node [width=2];
      L1 [label="Drill (Lead)\nAction: Spawn 2+", fillcolor=lightblue];
      L2 [label="Verify (Ambiguous)\nAction: Spawn 1+", fillcolor=purple];
      L3 [label="Dead (Pruned)\nAction: Stop", fillcolor=red];
      L4 [label="Valid (Solution)\nAction: Stop", fillcolor=green];
      L5 [label="Spec (Theory)\nAction: Stop", fillcolor=gold];
  }
}
```

## 4.2 Summary & Fix
After the graph, provide:
1.  **The Root Cause** (Derived from Green nodes).
2.  **The Exact Fix** (Code blocks/Configs).
3.  **Alternative Theories** (Yellow nodes).