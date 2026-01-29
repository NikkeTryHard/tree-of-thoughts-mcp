import { describe, it, expect } from "vitest";
import {
  NodeState,
  getRequiredChildren,
  getValidChildStates,
  isTerminalState,
} from "./types.js";

describe("types", () => {
  describe("isTerminalState", () => {
    it("returns true for DEAD", () => {
      expect(isTerminalState(NodeState.DEAD)).toBe(true);
    });

    it("returns true for VERIFY", () => {
      expect(isTerminalState(NodeState.VERIFY)).toBe(true);
    });

    it("returns false for EXPLORE", () => {
      expect(isTerminalState(NodeState.EXPLORE)).toBe(false);
    });

    it("returns false for FOUND", () => {
      expect(isTerminalState(NodeState.FOUND)).toBe(false);
    });

    it("returns false for EXHAUST", () => {
      expect(isTerminalState(NodeState.EXHAUST)).toBe(false);
    });
  });

  describe("getRequiredChildren", () => {
    describe("EXPLORE state", () => {
      it("returns 2 for R1", () => {
        expect(getRequiredChildren(NodeState.EXPLORE, 1)).toBe(2);
      });

      it("returns 2 for R2", () => {
        expect(getRequiredChildren(NodeState.EXPLORE, 2)).toBe(2);
      });

      it("returns 1 for R3", () => {
        expect(getRequiredChildren(NodeState.EXPLORE, 3)).toBe(1);
      });

      it("returns 1 for R4+", () => {
        expect(getRequiredChildren(NodeState.EXPLORE, 4)).toBe(1);
        expect(getRequiredChildren(NodeState.EXPLORE, 5)).toBe(1);
        expect(getRequiredChildren(NodeState.EXPLORE, 10)).toBe(1);
      });

      it("defaults to round 1 when not specified", () => {
        expect(getRequiredChildren(NodeState.EXPLORE)).toBe(2);
      });
    });

    describe("FOUND state", () => {
      it("returns 1 regardless of round", () => {
        expect(getRequiredChildren(NodeState.FOUND, 1)).toBe(1);
        expect(getRequiredChildren(NodeState.FOUND, 4)).toBe(1);
        expect(getRequiredChildren(NodeState.FOUND)).toBe(1);
      });
    });

    describe("EXHAUST state", () => {
      it("returns 1 regardless of round", () => {
        expect(getRequiredChildren(NodeState.EXHAUST, 1)).toBe(1);
        expect(getRequiredChildren(NodeState.EXHAUST, 5)).toBe(1);
        expect(getRequiredChildren(NodeState.EXHAUST)).toBe(1);
      });
    });

    describe("terminal states", () => {
      it("returns 0 for DEAD", () => {
        expect(getRequiredChildren(NodeState.DEAD)).toBe(0);
        expect(getRequiredChildren(NodeState.DEAD, 3)).toBe(0);
      });

      it("returns 0 for VERIFY", () => {
        expect(getRequiredChildren(NodeState.VERIFY)).toBe(0);
        expect(getRequiredChildren(NodeState.VERIFY, 5)).toBe(0);
      });
    });
  });

  describe("getValidChildStates", () => {
    describe("EXPLORE parent", () => {
      it("allows all states as children", () => {
        const validStates = getValidChildStates(NodeState.EXPLORE);
        expect(validStates).toContain(NodeState.EXPLORE);
        expect(validStates).toContain(NodeState.FOUND);
        expect(validStates).toContain(NodeState.EXHAUST);
        expect(validStates).toContain(NodeState.DEAD);
        expect(validStates).toContain(NodeState.VERIFY);
        expect(validStates).toHaveLength(5);
      });
    });

    describe("FOUND parent", () => {
      it("allows EXPLORE, FOUND, and VERIFY", () => {
        const validStates = getValidChildStates(NodeState.FOUND);
        expect(validStates).toContain(NodeState.EXPLORE);
        expect(validStates).toContain(NodeState.FOUND);
        expect(validStates).toContain(NodeState.VERIFY);
      });

      it("does NOT allow EXHAUST or DEAD", () => {
        const validStates = getValidChildStates(NodeState.FOUND);
        expect(validStates).not.toContain(NodeState.EXHAUST);
        expect(validStates).not.toContain(NodeState.DEAD);
        expect(validStates).toHaveLength(3);
      });
    });

    describe("EXHAUST parent", () => {
      it("allows EXPLORE, EXHAUST, and DEAD", () => {
        const validStates = getValidChildStates(NodeState.EXHAUST);
        expect(validStates).toContain(NodeState.EXPLORE);
        expect(validStates).toContain(NodeState.EXHAUST);
        expect(validStates).toContain(NodeState.DEAD);
      });

      it("does NOT allow FOUND or VERIFY", () => {
        const validStates = getValidChildStates(NodeState.EXHAUST);
        expect(validStates).not.toContain(NodeState.FOUND);
        expect(validStates).not.toContain(NodeState.VERIFY);
        expect(validStates).toHaveLength(3);
      });
    });

    describe("terminal states", () => {
      it("returns empty array for DEAD", () => {
        expect(getValidChildStates(NodeState.DEAD)).toEqual([]);
      });

      it("returns empty array for VERIFY", () => {
        expect(getValidChildStates(NodeState.VERIFY)).toEqual([]);
      });
    });
  });
});
