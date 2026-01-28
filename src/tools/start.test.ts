import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { handleStart } from "./start";
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
      { query: "Test", minRoots: 5 },
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
      { query: "Persist test", minRoots: 5 },
      TEST_DIR
    );

    const filePath = `${TEST_DIR}/${result.sessionId}.json`;
    expect(existsSync(filePath)).toBe(true);
  });
});
