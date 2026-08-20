import {
  ANALYTICS_TIMEZONE,
  AnalyticsPeriodError,
  listDayKeys,
  resolvePeriod,
  resolvePreviousPeriod,
  toAnalyticsDayKey,
} from "../src/services/ai/analytics/period.util";

// 2026-03-18T04:00:00Z => 2026-03-17 22:00 en America/Mexico_City.
const NIGHT_BEFORE_UTC_ROLLOVER = new Date("2026-03-18T04:00:00.000Z");
// 2026-03-18T18:00:00Z => 2026-03-18 12:00 en America/Mexico_City.
const MIDDAY = new Date("2026-03-18T18:00:00.000Z");

describe("resolvePeriod", () => {
  it("usa la zona horaria del negocio y no la UTC del servidor", () => {
    expect(toAnalyticsDayKey(NIGHT_BEFORE_UTC_ROLLOVER)).toBe("2026-03-17");

    const period = resolvePeriod({ period: "today" }, NIGHT_BEFORE_UTC_ROLLOVER);

    expect(period.timeZone).toBe(ANALYTICS_TIMEZONE);
    expect(period.fromDayKey).toBe("2026-03-17");
    expect(period.toDayKey).toBe("2026-03-17");
    expect(period.days).toBe(1);
  });

  it("resuelve hoy como un rango de 24 horas locales", () => {
    const period = resolvePeriod({ period: "today" }, MIDDAY);

    expect(period.fromDayKey).toBe("2026-03-18");
    expect(period.start.toISOString()).toBe("2026-03-18T06:00:00.000Z");
    expect(period.endExclusive.toISOString()).toBe("2026-03-19T06:00:00.000Z");
  });

  it("resuelve ayer", () => {
    const period = resolvePeriod({ period: "yesterday" }, MIDDAY);

    expect(period.fromDayKey).toBe("2026-03-17");
    expect(period.toDayKey).toBe("2026-03-17");
  });

  it("resuelve la semana en curso empezando en lunes", () => {
    // 2026-03-18 es miercoles.
    const period = resolvePeriod({ period: "this_week" }, MIDDAY);

    expect(period.fromDayKey).toBe("2026-03-16");
    expect(period.toDayKey).toBe("2026-03-18");
    expect(period.days).toBe(3);
  });

  it("resuelve la semana pasada completa", () => {
    const period = resolvePeriod({ period: "last_week" }, MIDDAY);

    expect(period.fromDayKey).toBe("2026-03-09");
    expect(period.toDayKey).toBe("2026-03-15");
    expect(period.days).toBe(7);
  });

  it("resuelve el mes en curso hasta hoy", () => {
    const period = resolvePeriod({ period: "this_month" }, MIDDAY);

    expect(period.fromDayKey).toBe("2026-03-01");
    expect(period.toDayKey).toBe("2026-03-18");
  });

  it("resuelve el mes pasado completo incluyendo febrero", () => {
    const period = resolvePeriod({ period: "last_month" }, MIDDAY);

    expect(period.fromDayKey).toBe("2026-02-01");
    expect(period.toDayKey).toBe("2026-02-28");
    expect(period.days).toBe(28);
  });

  it("resuelve ventanas moviles inclusivas", () => {
    expect(resolvePeriod({ period: "last_7_days" }, MIDDAY).fromDayKey).toBe(
      "2026-03-12",
    );
    expect(resolvePeriod({ period: "last_7_days" }, MIDDAY).days).toBe(7);
    expect(resolvePeriod({ period: "last_30_days" }, MIDDAY).fromDayKey).toBe(
      "2026-02-17",
    );
    expect(resolvePeriod({ period: "last_30_days" }, MIDDAY).days).toBe(30);
  });

  it("resuelve el anio en curso", () => {
    const period = resolvePeriod({ period: "this_year" }, MIDDAY);

    expect(period.fromDayKey).toBe("2026-01-01");
    expect(period.toDayKey).toBe("2026-03-18");
  });

  it("usa last_30_days cuando no se indica periodo", () => {
    expect(resolvePeriod({}, MIDDAY).key).toBe("last_30_days");
  });

  it("acepta rangos personalizados validos", () => {
    const period = resolvePeriod(
      { period: "custom", from: "2026-01-05", to: "2026-01-09" },
      MIDDAY,
    );

    expect(period.days).toBe(5);
    expect(period.start.toISOString()).toBe("2026-01-05T06:00:00.000Z");
    expect(period.endExclusive.toISOString()).toBe("2026-01-10T06:00:00.000Z");
  });

  it("rechaza rangos personalizados incompletos o invertidos", () => {
    expect(() => resolvePeriod({ period: "custom", from: "2026-01-05" }, MIDDAY)).toThrow(
      AnalyticsPeriodError,
    );
    expect(() =>
      resolvePeriod(
        { period: "custom", from: "2026-02-10", to: "2026-02-01" },
        MIDDAY,
      ),
    ).toThrow(AnalyticsPeriodError);
    expect(() =>
      resolvePeriod({ period: "custom", from: "05/01/2026", to: "2026-01-09" }, MIDDAY),
    ).toThrow(AnalyticsPeriodError);
    expect(() =>
      resolvePeriod({ period: "custom", from: "2026-02-30", to: "2026-03-01" }, MIDDAY),
    ).toThrow(AnalyticsPeriodError);
  });
});

describe("resolvePreviousPeriod", () => {
  it("devuelve la ventana previa del mismo tamano", () => {
    const current = resolvePeriod({ period: "last_7_days" }, MIDDAY);
    const previous = resolvePreviousPeriod(current);

    expect(previous.fromDayKey).toBe("2026-03-05");
    expect(previous.toDayKey).toBe("2026-03-11");
    expect(previous.days).toBe(current.days);
  });

  it("compara el mes en curso contra el mismo tramo del mes anterior", () => {
    const current = resolvePeriod({ period: "this_month" }, MIDDAY);
    const previous = resolvePreviousPeriod(current);

    expect(previous.fromDayKey).toBe("2026-02-01");
    expect(previous.toDayKey).toBe("2026-02-18");
  });

  it("recorta al ultimo dia disponible cuando el mes anterior es mas corto", () => {
    const march31 = new Date("2026-03-31T18:00:00.000Z");
    const current = resolvePeriod({ period: "this_month" }, march31);
    const previous = resolvePreviousPeriod(current);

    expect(previous.toDayKey).toBe("2026-02-28");
  });
});

describe("listDayKeys", () => {
  it("enumera todos los dias del periodo", () => {
    const period = resolvePeriod(
      { period: "custom", from: "2026-01-30", to: "2026-02-02" },
      MIDDAY,
    );

    expect(listDayKeys(period)).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });
});
