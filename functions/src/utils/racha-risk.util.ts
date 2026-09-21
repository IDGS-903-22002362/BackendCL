import { previousDayKey, toDayKey } from "./day-key.util";

export const RACHA_TIMEZONE = "America/Mexico_City";

export type RachaRiskSnapshot = {
  atRisk: boolean;
  todayKey: string;
  yesterdayKey: string;
  streakCount: number;
  streakLastDay: string | null;
};

export function evaluateRachaRisk(
  data: Record<string, unknown> | { streakCount?: unknown; streakLastDay?: unknown },
  timeZone = RACHA_TIMEZONE,
  now = new Date(),
): RachaRiskSnapshot {
  const todayKey = toDayKey(now, timeZone);
  const yesterdayKey = previousDayKey(todayKey);
  const parsedCount = Number(data.streakCount ?? 0);
  const streakCount = Number.isFinite(parsedCount) ? parsedCount : 0;
  const streakLastDay =
    typeof data.streakLastDay === "string" && data.streakLastDay.trim()
      ? data.streakLastDay.trim()
      : null;

  return {
    atRisk: streakCount > 0 && streakLastDay === yesterdayKey,
    todayKey,
    yesterdayKey,
    streakCount,
    streakLastDay,
  };
}
