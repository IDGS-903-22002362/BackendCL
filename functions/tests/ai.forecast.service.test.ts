/**
 * Pronostico del Asistente Administrativo.
 *
 * El objetivo de estas pruebas es que el forecast sea calculado y verificable:
 * el modelo de lenguaje solo interpreta lo que produce este servicio, asi que
 * cada caso comprueba metodo elegido, banda de incertidumbre y honestidad
 * cuando no hay suficiente historial.
 */

import {
  MAX_FORECAST_HORIZON,
  MIN_FORECAST_OBSERVATIONS,
  SeriesPoint,
  __forecastTestables,
  forecastSeries,
} from "../src/services/ai/analytics/forecast.service";

const START_DAY = "2026-05-01";

const buildSeries = (values: number[], startDay = START_DAY): SeriesPoint[] =>
  values.map((value, index) => ({
    date: __forecastTestables.addDays(startDay, index),
    value,
  }));

const expectAvailable = (outcome: ReturnType<typeof forecastSeries>) => {
  if (!outcome.available) {
    throw new Error(`Se esperaba un pronostico disponible: ${outcome.reason}`);
  }
  return outcome;
};

describe("forecastSeries", () => {
  it("no pronostica cuando el historial es insuficiente", () => {
    const outcome = forecastSeries({
      series: buildSeries([10, 12, 9, 11, 13, 10, 12]),
      horizon: 7,
    });

    expect(outcome.available).toBe(false);
    if (!outcome.available) {
      expect(outcome.minimumObservations).toBe(MIN_FORECAST_OBSERVATIONS);
      expect(outcome.observations).toBe(7);
      expect(outcome.missing.join(" ")).toContain("14");
    }
  });

  it("es determinista: la misma serie produce el mismo pronostico", () => {
    const series = buildSeries(
      Array.from({ length: 40 }, (_, index) => 100 + (index % 5) * 3),
    );

    const first = expectAvailable(forecastSeries({ series, horizon: 7 }));
    const second = expectAvailable(forecastSeries({ series, horizon: 7 }));

    expect(second.method).toBe(first.method);
    expect(second.forecast).toEqual(first.forecast);
    expect(second.error).toEqual(first.error);
  });

  it("sigue una tendencia creciente hacia arriba", () => {
    const series = buildSeries(
      Array.from({ length: 60 }, (_, index) => 100 + index * 5),
    );

    const outcome = expectAvailable(forecastSeries({ series, horizon: 7 }));
    const last = series[series.length - 1].value;

    expect(outcome.forecast).toHaveLength(7);
    expect(outcome.forecast[0].value).toBeGreaterThan(last);
    expect(outcome.forecast[6].value).toBeGreaterThan(outcome.forecast[0].value);
    expect(outcome.method).toBe("damped_trend");
  });

  it("sigue una tendencia decreciente hacia abajo sin cruzar a negativo", () => {
    const series = buildSeries(
      Array.from({ length: 60 }, (_, index) => 400 - index * 6),
    );

    const outcome = expectAvailable(forecastSeries({ series, horizon: 14 }));

    expect(outcome.forecast[0].value).toBeLessThan(
      series[series.length - 1].value,
    );
    for (const point of outcome.forecast) {
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.lower).toBeGreaterThanOrEqual(0);
    }
  });

  it("elige estacionalidad semanal cuando el patron es por dia de la semana", () => {
    const weekly = [200, 40, 45, 50, 55, 120, 210];
    const series = buildSeries(
      Array.from({ length: 70 }, (_, index) => weekly[index % 7]),
    );

    const outcome = expectAvailable(forecastSeries({ series, horizon: 7 }));

    expect(outcome.method).toBe("seasonal_naive");
    expect(outcome.forecast.map((point) => point.value)).toEqual(
      outcome.forecast.map((point, index) => weekly[(index + 70) % 7]),
    );
    expect(outcome.quality).toBe("alta");
  });

  it("proyecta el mismo valor y banda nula en una serie constante", () => {
    const series = buildSeries(Array.from({ length: 40 }, () => 250));

    const outcome = expectAvailable(forecastSeries({ series, horizon: 7 }));

    expect(outcome.error.mae).toBe(0);
    expect(outcome.error.mape).toBe(0);
    for (const point of outcome.forecast) {
      expect(point.value).toBe(250);
      expect(point.lower).toBe(250);
      expect(point.upper).toBe(250);
    }
  });

  it("marca calidad baja y advierte cuando la serie esta casi siempre en cero", () => {
    const values = Array.from({ length: 40 }, (_, index) =>
      index % 10 === 0 ? 3 : 0,
    );

    const outcome = expectAvailable(
      forecastSeries({ series: buildSeries(values), horizon: 7 }),
    );

    expect(outcome.quality).toBe("baja");
    expect(outcome.nonZeroObservations).toBe(4);
    expect(outcome.notes.join(" ")).toContain("cero");
  });

  it("no deja que un outlier domine el valor proyectado", () => {
    const values = Array.from({ length: 40 }, () => 100);
    values[20] = 5000;

    const outcome = expectAvailable(
      forecastSeries({ series: buildSeries(values), horizon: 7 }),
    );

    expect(outcome.forecast[0].value).toBeLessThan(400);
    expect(outcome.forecast[0].upper).toBeGreaterThan(
      outcome.forecast[0].value,
    );
  });

  it("recorta el horizonte cuando el historial es corto y lo declara", () => {
    const outcome = expectAvailable(
      forecastSeries({
        series: buildSeries(
          Array.from({ length: 20 }, (_, index) => 80 + (index % 4) * 5),
        ),
        horizon: 30,
      }),
    );

    expect(outcome.requestedHorizon).toBe(30);
    expect(outcome.horizon).toBe(10);
    expect(outcome.forecast).toHaveLength(10);
    expect(outcome.notes.join(" ")).toContain("horizonte se redujo");
  });

  it("nunca proyecta mas alla del horizonte maximo de la fase", () => {
    const outcome = expectAvailable(
      forecastSeries({
        series: buildSeries(
          Array.from({ length: 120 }, (_, index) => 300 + (index % 7) * 10),
        ),
        horizon: 90,
      }),
    );

    expect(outcome.horizon).toBe(MAX_FORECAST_HORIZON);
  });

  it("expone banda de incertidumbre, error historico y metodos evaluados", () => {
    const outcome = expectAvailable(
      forecastSeries({
        series: buildSeries(
          Array.from({ length: 60 }, (_, index) => 500 + ((index * 37) % 90)),
        ),
        horizon: 7,
      }),
    );

    expect(outcome.candidates.length).toBeGreaterThan(1);
    expect(outcome.error.samples).toBeGreaterThan(0);
    expect(outcome.intervalBasis).toContain("backtesting");
    expect(outcome.historyFrom).toBe(START_DAY);

    for (const point of outcome.forecast) {
      expect(point.lower).toBeLessThanOrEqual(point.value);
      expect(point.upper).toBeGreaterThanOrEqual(point.value);
    }
  });

  it("proyecta dias consecutivos a partir del ultimo dia observado", () => {
    const series = buildSeries(
      Array.from({ length: 30 }, (_, index) => 100 + index),
      "2026-02-20",
    );

    const outcome = expectAvailable(forecastSeries({ series, horizon: 3 }));

    expect(series[series.length - 1].date).toBe("2026-03-21");
    expect(outcome.forecast.map((point) => point.date)).toEqual([
      "2026-03-22",
      "2026-03-23",
      "2026-03-24",
    ]);
  });

  it("ignora valores no finitos en lugar de propagar NaN", () => {
    const series = [
      ...buildSeries(Array.from({ length: 30 }, () => 120)),
      { date: "2026-06-01", value: Number.NaN },
    ];

    const outcome = expectAvailable(forecastSeries({ series, horizon: 5 }));

    expect(outcome.observations).toBe(30);
    for (const point of outcome.forecast) {
      expect(Number.isFinite(point.value)).toBe(true);
    }
  });
});

describe("backtest", () => {
  it("evalua origenes rodantes usando solo el pasado de cada corte", () => {
    const values = Array.from({ length: 30 }, (_, index) => 50 + index);
    const outcome = __forecastTestables.backtest(values, "naive", 3);

    expect(outcome).not.toBeNull();
    expect(outcome?.origins).toBe(20);
    // El naive sobre una serie que crece 1 por dia se equivoca exactamente en
    // el numero de pasos proyectados.
    expect(outcome?.errorsByStep.get(1)?.every((error) => error === 1)).toBe(true);
    expect(outcome?.errorsByStep.get(2)?.every((error) => error === 2)).toBe(true);
  });
});
