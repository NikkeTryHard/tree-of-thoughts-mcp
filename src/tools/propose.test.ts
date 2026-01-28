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
          { id: "R1.B", parent: null, title: "Node B", plannedAction: "Do B" },
          { id: "R1.C", parent: null, title: "Node C", plannedAction: "Do C" },
        ],
      },
      TEST_DIR
    );

    expect(result.approvedNodes).toContain("R1.A");
  });
});
