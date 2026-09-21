import { evaluateRachaRisk } from "../src/utils/racha-risk.util";

describe("evaluateRachaRisk", () => {
  const now = new Date("2026-08-27T22:00:00.000-06:00");

  it("marks an active streak as at risk when last check-in was yesterday", () => {
    const result = evaluateRachaRisk(
      { streakCount: 12, streakLastDay: "2026-08-26" },
      "America/Mexico_City",
      now,
    );

    expect(result).toEqual({
      atRisk: true,
      todayKey: "2026-08-27",
      yesterdayKey: "2026-08-26",
      streakCount: 12,
      streakLastDay: "2026-08-26",
    });
  });

  it("does not mark a claimed today streak as at risk", () => {
    const result = evaluateRachaRisk(
      { streakCount: 12, streakLastDay: "2026-08-27" },
      "America/Mexico_City",
      now,
    );

    expect(result.atRisk).toBe(false);
  });

  it("does not mark a broken streak as at risk", () => {
    const result = evaluateRachaRisk(
      { streakCount: 40, streakLastDay: "2026-08-24" },
      "America/Mexico_City",
      now,
    );

    expect(result.atRisk).toBe(false);
  });

  it("treats a 1-day streak from yesterday as at risk", () => {
    const result = evaluateRachaRisk(
      { streakCount: 1, streakLastDay: "2026-08-26" },
      "America/Mexico_City",
      now,
    );

    expect(result.atRisk).toBe(true);
    expect(result.streakCount).toBe(1);
  });

  it("does not mark a zero or invalid streak count as at risk", () => {
    expect(
      evaluateRachaRisk(
        { streakCount: 0, streakLastDay: "2026-08-26" },
        "America/Mexico_City",
        now,
      ).atRisk,
    ).toBe(false);
    expect(
      evaluateRachaRisk(
        { streakCount: "abc", streakLastDay: "2026-08-26" },
        "America/Mexico_City",
        now,
      ).atRisk,
    ).toBe(false);
  });
});
