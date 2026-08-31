import {
  evaluateBirthdayToday,
  isBirthdayToday,
  isValidCalendarDate,
  parseFechaNacimiento,
} from "../src/utils/birthday.util";

describe("parseFechaNacimiento", () => {
  it("reads YYYY-MM-DD without shifting the calendar day", () => {
    expect(parseFechaNacimiento("2000-08-31")).toEqual({
      year: 2000,
      month: 8,
      day: 31,
    });
  });

  it("reads ISO strings by literal prefix, not local timezone", () => {
    expect(parseFechaNacimiento("2008-08-13T00:00:00.000Z")).toEqual({
      year: 2008,
      month: 8,
      day: 13,
    });
    expect(parseFechaNacimiento("2008-08-13T06:00:00.000")).toEqual({
      year: 2008,
      month: 8,
      day: 13,
    });
  });

  it("reads Firestore Timestamps in UTC so midnight does not move to the previous day", () => {
    expect(
      parseFechaNacimiento({
        toDate: () => new Date("1990-01-01T00:00:00.000Z"),
      }),
    ).toEqual({ year: 1990, month: 1, day: 1 });
  });

  it("reads Date, seconds maps, epoch millis, DD/MM/YYYY and Spanish dates", () => {
    expect(parseFechaNacimiento(new Date("1995-12-31T00:00:00.000Z"))).toEqual({
      year: 1995,
      month: 12,
      day: 31,
    });
    expect(parseFechaNacimiento({ seconds: 946684800 })).toEqual({
      year: 2000,
      month: 1,
      day: 1,
    });
    expect(parseFechaNacimiento(946684800000)).toEqual({
      year: 2000,
      month: 1,
      day: 1,
    });
    expect(parseFechaNacimiento("31/08/2000")).toEqual({
      year: 2000,
      month: 8,
      day: 31,
    });
    expect(parseFechaNacimiento("13 de agosto de 2008")).toEqual({
      year: 2008,
      month: 8,
      day: 13,
    });
  });

  it("rejects invalid calendar dates such as 31 April", () => {
    expect(parseFechaNacimiento("2001-04-31")).toBeNull();
    expect(isValidCalendarDate(2001, 4, 31)).toBe(false);
    expect(parseFechaNacimiento("29/02/2026")).toBeNull();
  });
});

describe("isBirthdayToday", () => {
  it("matches month and day regardless of year", () => {
    expect(
      isBirthdayToday(
        { year: 1990, month: 8, day: 31 },
        { year: 2026, month: 8, day: 31 },
      ),
    ).toBe(true);
  });

  it("celebrates 29 Feb on 28 Feb in non-leap years", () => {
    expect(
      isBirthdayToday(
        { year: 2000, month: 2, day: 29 },
        { year: 2026, month: 2, day: 28 },
      ),
    ).toBe(true);
    expect(
      isBirthdayToday(
        { year: 2000, month: 2, day: 29 },
        { year: 2024, month: 2, day: 28 },
      ),
    ).toBe(false);
  });
});

describe("evaluateBirthdayToday", () => {
  it("uses America/Mexico_City today, not UTC", () => {
    const lateMexicoEvening = new Date("2026-08-31T23:30:00.000-06:00");
    const justAfterMexicoMidnight = new Date("2026-09-01T00:30:00.000-06:00");

    expect(
      evaluateBirthdayToday("1999-08-31", "America/Mexico_City", lateMexicoEvening)
        .isBirthday,
    ).toBe(true);
    expect(
      evaluateBirthdayToday(
        "1999-08-31",
        "America/Mexico_City",
        justAfterMexicoMidnight,
      ).isBirthday,
    ).toBe(false);
  });
});
