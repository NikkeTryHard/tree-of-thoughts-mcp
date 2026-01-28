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
