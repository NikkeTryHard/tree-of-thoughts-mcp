import { NodeState, STATE_COLORS } from "../types";
import type { InvestigationState } from "./investigation";

export class DotGenerator {
  static generate(state: InvestigationState): string {
    const lines: string[] = [];

    lines.push("digraph Investigation {");
    lines.push("  rankdir=TB;");
    lines.push('  node [shape=box, style="filled,rounded", fontname="Arial"];');
    lines.push("");

    const maxRound = Math.max(0, ...Object.values(state.data.nodes).map((n) => n.round));

    for (let round = 1; round <= maxRound; round++) {
      const nodesInRound = state.getNodesByRound(round);
      if (nodesInRound.length === 0) continue;

      lines.push(`  // --- Round ${round} ---`);

      for (const node of nodesInRound) {
        const sanitizedId = this.sanitizeId(node.id);
        const color = STATE_COLORS[node.state];
        const label = this.escapeLabel(`R${node.round} | ${node.title}\\n(${node.state})`);

        lines.push(`  ${sanitizedId} [fillcolor=${color}, label="${label}"];`);
      }
      lines.push("");
    }

    lines.push("  // --- Edges ---");
    for (const node of Object.values(state.data.nodes)) {
      if (node.parent) {
        const parentId = this.sanitizeId(node.parent);
        const childId = this.sanitizeId(node.id);
        lines.push(`  ${parentId} -> ${childId};`);
      }
    }
    lines.push("");

    lines.push("  // --- Legend ---");
    lines.push("  subgraph cluster_legend {");
    lines.push('    label="States";');
    lines.push("    node [width=2];");
    lines.push(`    L_EXPLORE [label="EXPLORE\\nSpawn >= 2", fillcolor=${STATE_COLORS[NodeState.EXPLORE]}];`);
    lines.push(`    L_FOUND [label="FOUND\\nNeeds VERIFY", fillcolor=${STATE_COLORS[NodeState.FOUND]}];`);
    lines.push(`    L_VERIFY [label="VERIFY\\nConfirmed", fillcolor=${STATE_COLORS[NodeState.VERIFY]}];`);
    lines.push(`    L_DEAD [label="DEAD\\nStop", fillcolor=${STATE_COLORS[NodeState.DEAD]}];`);
    lines.push("  }");
    lines.push("}");

    return lines.join("\n");
  }

  private static sanitizeId(id: string): string {
    return id.replace(/\./g, "_");
  }

  private static escapeLabel(label: string): string {
    return label.replace(/"/g, '\\"').replace(/</g, "\\<").replace(/>/g, "\\>");
  }
}
