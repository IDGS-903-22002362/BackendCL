export type PrizeRollMode = "zero" | "last" | "exact";

type PrizeRoll = {
  mode: PrizeRollMode;
  exact: number;
  lastSpan: number;
  spans: number[];
  reset: () => void;
  take: (span: number) => number;
};

const ROLL_KEY = Symbol.for("club-leon-prize-roll");

function createPrizeRoll(): PrizeRoll {
  return {
    mode: "zero",
    exact: 0,
    lastSpan: 0,
    spans: [],
    reset() {
      this.mode = "zero";
      this.exact = 0;
      this.lastSpan = 0;
      this.spans = [];
    },
    take(span: number) {
      this.lastSpan = span;
      this.spans.push(span);
      if (span <= 0) return 0;
      if (this.mode === "last") return span - 1;
      if (this.mode === "exact") {
        if (!Number.isInteger(this.exact) || this.exact < 0 || this.exact >= span) {
          throw new Error(`cursor ${this.exact} fuera de rango 0..${span - 1}`);
        }
        return this.exact;
      }
      return 0;
    },
  };
}

const globalStore = globalThis as typeof globalThis & {
  [ROLL_KEY]?: PrizeRoll;
};

export const prizeRoll = globalStore[ROLL_KEY] ?? (globalStore[ROLL_KEY] = createPrizeRoll());
