import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, mkdirSync } from "fs";
import { handleStart } from "./start";
import { handlePropose } from "./propose";
import { handleCommit } from "./commit";
import { handleEnd } from "./end";
import { NodeState } from "../types";

const TEST_DIR = "./test-end-investigations";

describe("references extraction", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("extracts references from findings", async () => {
    // Setup complete investigation with references in findings
    const startResult = await handleStart({ query: "test" }, TEST_DIR);
    const sessionId = startResult.sessionId;

    // Build complete tree to R5 with VERIFY (min 5 rounds required)
    await handlePropose({ sessionId, nodes: [{ id: "R1.A", parent: null, title: "R1", plannedAction: "t" }] }, TEST_DIR);
    await handleCommit(
      {
        sessionId,
        results: [
          {
            nodeId: "R1.A",
            state: NodeState.EXPLORE,
            findings: "Found something\n\n## References\n- https://example.com - docs",
            agentId: "d000001",
          },
        ],
      },
      TEST_DIR,
    );

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R2.A1", parent: "R1.A", title: "R2a", plannedAction: "t" },
          { id: "R2.A2", parent: "R1.A", title: "R2b", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R2.A1", state: NodeState.EXPLORE, findings: "x\n\n## References\n- src/file.ts", agentId: "d000002" },
          { nodeId: "R2.A2", state: NodeState.EXPLORE, findings: "x", agentId: "d000003" },
        ],
      },
      TEST_DIR,
    );

    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R3.A1a", parent: "R2.A1", title: "R3a", plannedAction: "t" },
          { id: "R3.A1b", parent: "R2.A1", title: "R3b", plannedAction: "t" },
          { id: "R3.A2a", parent: "R2.A2", title: "R3c", plannedAction: "t" },
          { id: "R3.A2b", parent: "R2.A2", title: "R3d", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R3.A1a", state: NodeState.EXPLORE, findings: "x", agentId: "d000004" },
          { nodeId: "R3.A1b", state: NodeState.EXHAUST, findings: "x", agentId: "d000005" },
          { nodeId: "R3.A2a", state: NodeState.EXHAUST, findings: "x", agentId: "d000006" },
          { nodeId: "R3.A2b", state: NodeState.EXHAUST, findings: "x", agentId: "d000007" },
        ],
      },
      TEST_DIR,
    );

    // R4 - FOUND allowed here, DEAD for EXHAUST children
    await handlePropose(
      {
        sessionId,
        nodes: [
          { id: "R4.A1a1", parent: "R3.A1a", title: "R4a", plannedAction: "t" },
          { id: "R4.A1a2", parent: "R3.A1a", title: "R4b", plannedAction: "t" },
          { id: "R4.A1b1", parent: "R3.A1b", title: "R4c", plannedAction: "t" },
          { id: "R4.A2a1", parent: "R3.A2a", title: "R4d", plannedAction: "t" },
          { id: "R4.A2b1", parent: "R3.A2b", title: "R4e", plannedAction: "t" },
        ],
      },
      TEST_DIR,
    );
    await handleCommit(
      {
        sessionId,
        results: [
          { nodeId: "R4.A1a1", state: NodeState.FOUND, findings: "solution\n\n## References\n- https://docs.com", agentId: "d000008" },
          { nodeId: "R4.A1a2", state: NodeState.DEAD, findings: "x", agentId: "d000009" },
          { nodeId: "R4.A1b1", state: NodeState.DEAD, findings: "x", agentId: "d000010" },
          { nodeId: "R4.A2a1", state: NodeState.DEAD, findings: "x", agentId: "d000011" },
          { nodeId: "R4.A2b1", state: NodeState.DEAD, findings: "x", agentId: "d000012" },
        ],
      },
      TEST_DIR,
    );

    // R5 - 2 VERIFY children (FOUND now requires 2)
    await handlePropose({
      sessionId,
      nodes: [
        { id: "R5.A1a1a", parent: "R4.A1a1", title: "Verify1", plannedAction: "verify" },
        { id: "R5.A1a1b", parent: "R4.A1a1", title: "Verify2", plannedAction: "verify" },
      ],
    }, TEST_DIR);
    await handleCommit({
      sessionId,
      results: [
        { nodeId: "R5.A1a1a", state: NodeState.VERIFY, findings: "confirmed", agentId: "d000013" },
        { nodeId: "R5.A1a1b", state: NodeState.VERIFY, findings: "confirmed", agentId: "d000014" },
      ],
    }, TEST_DIR);

    const result = await handleEnd({ sessionId }, TEST_DIR);

    expect(result.status).toBe("OK");
    expect(result.references).toBeDefined();
    expect(result.references).toContain("https://example.com");
    expect(result.references).toContain("https://docs.com");
    expect(result.references).toContain("src/file.ts");
  });
});
