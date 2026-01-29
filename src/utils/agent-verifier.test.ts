import { describe, test, expect } from "bun:test";
import { verifyAgent, verifyAgents } from "./agent-verifier";

describe("Agent Verifier", () => {
  test("rejects invalid format - non-hex characters", () => {
    const result = verifyAgent("verify-a", "/tmp/test");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid format");
  });

  test("rejects invalid format - wrong length", () => {
    const result = verifyAgent("abc123", "/tmp/test");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid format");
  });

  test("rejects invalid format - too long", () => {
    const result = verifyAgent("ae52219abc", "/tmp/test");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid format");
  });

  test("accepts valid format when no sessions found", () => {
    // Valid 7-char hex but project doesn't exist - should allow with warning
    const result = verifyAgent("ae52219", "/nonexistent/project/path");
    expect(result.valid).toBe(true);
    expect(result.reason).toContain("Could not find Claude Code sessions");
  });

  test("rejects fake agentId patterns", () => {
    const fakePatterns = ["verify-a", "main", "test123", "ABCDEFG", "1234567890"];
    for (const fake of fakePatterns) {
      const result = verifyAgent(fake, "/tmp/test");
      expect(result.valid).toBe(false);
    }
  });

  test("verifyAgents batch processes multiple agents", () => {
    const results = verifyAgents(["ae52219", "invalid!", "1234567"], "/tmp/test");
    expect(results.length).toBe(3);
    expect(results[0].valid).toBe(true); // Valid format, no sessions
    expect(results[1].valid).toBe(false); // Invalid format
    expect(results[2].valid).toBe(true); // Valid hex format
  });
});
