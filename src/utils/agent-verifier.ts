import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface VerificationResult {
  valid: boolean;
  agentId: string;
  foundIn?: string; // Session where found
  reason?: string; // Why invalid
}

/**
 * Encode project path to Claude Code format
 * /home/user/myproject -> -home-user-myproject
 */
function encodeProjectPath(projectDir: string): string {
  return projectDir.replace(/\//g, "-");
}

/**
 * Get the top N most recent session directories for a project
 */
function getRecentSessions(projectDir: string, limit: number = 5): string[] {
  const claudeDir = path.join(os.homedir(), ".claude", "projects");
  const encodedPath = encodeProjectPath(projectDir);
  const projectPath = path.join(claudeDir, encodedPath);

  if (!fs.existsSync(projectPath)) {
    return [];
  }

  // Find all .jsonl files (sessions)
  const files = fs
    .readdirSync(projectPath)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({
      name: f.replace(".jsonl", ""),
      mtime: fs.statSync(path.join(projectPath, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime) // Most recent first
    .slice(0, limit)
    .map((f) => f.name);

  return files;
}

/**
 * Check if an agent file exists in any of the recent sessions
 */
export function verifyAgent(agentId: string, projectDir: string): VerificationResult {
  // 1. Validate format first (must be 7-char hex)
  if (!/^[a-f0-9]{7}$/.test(agentId)) {
    return {
      valid: false,
      agentId,
      reason: `Invalid format. Expected 7-char hex (e.g., ae52219), got "${agentId}"`,
    };
  }

  // 2. Get recent sessions
  const sessions = getRecentSessions(projectDir, 5);
  if (sessions.length === 0) {
    // Can't verify - no sessions found, allow with warning
    return {
      valid: true, // Don't block if we can't find sessions
      agentId,
      reason: "Could not find Claude Code sessions to verify against",
    };
  }

  // 3. Search for agent file in each session's subagents folder
  const claudeDir = path.join(os.homedir(), ".claude", "projects");
  const encodedPath = encodeProjectPath(projectDir);

  for (const sessionId of sessions) {
    const agentFile = path.join(claudeDir, encodedPath, sessionId, "subagents", `agent-${agentId}.jsonl`);

    if (fs.existsSync(agentFile)) {
      return {
        valid: true,
        agentId,
        foundIn: sessionId,
      };
    }
  }

  // 4. Not found in any session
  return {
    valid: false,
    agentId,
    reason: `Agent file not found in top ${sessions.length} sessions. Did you actually spawn an agent?`,
  };
}

/**
 * Batch verify multiple agentIds
 */
export function verifyAgents(agentIds: string[], projectDir: string): VerificationResult[] {
  return agentIds.map((id) => verifyAgent(id, projectDir));
}
