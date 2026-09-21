const userDocs: Array<{
  id: string;
  data: () => Record<string, unknown>;
}> = [];
const enqueueEventMock = jest.fn();

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: jest.fn(),
  },
}));

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {
    collection: jest.fn((collectionName: string) => {
      if (collectionName !== "usuariosApp") {
        throw new Error(`Unexpected collection: ${collectionName}`);
      }

      const query: {
        where: jest.Mock;
        limit: jest.Mock;
        startAfter: jest.Mock;
        get: () => Promise<{ empty: boolean; size: number; docs: typeof userDocs }>;
      } = {
        where: jest.fn(() => query),
        limit: jest.fn(() => query),
        startAfter: jest.fn(() => query),
        async get() {
          return {
            empty: userDocs.length === 0,
            size: userDocs.length,
            docs: userDocs,
          };
        },
      };

      return query;
    }),
  },
}));

jest.mock("../src/services/notifications/notification-event.service", () => ({
  __esModule: true,
  default: {
    enqueueEvent: enqueueEventMock,
  },
}));

import notificationSchedulerService from "../src/services/notifications/notification-scheduler.service";

describe("notificationSchedulerService enqueueStreakReminders", () => {
  const now = new Date("2026-08-27T23:05:00.000-06:00");

  beforeEach(() => {
    userDocs.length = 0;
    enqueueEventMock.mockReset();
  });

  it("encola un recordatorio para rachas activas sin check-in de hoy", async () => {
    userDocs.push({
      id: "uid_1",
      data: () => ({
        uid: "uid_1",
        streakCount: 7,
        streakLastDay: "2026-08-26",
      }),
    });
    enqueueEventMock.mockResolvedValue({
      event: { id: "event_1" },
      created: true,
    });

    const results = await notificationSchedulerService.enqueueStreakReminders(now);

    expect(enqueueEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "streak_reminder",
        userId: "uid_1",
        triggerSource: "scheduler_streak_reminder",
        fingerprintParts: ["streak_reminder", "uid_1", "2026-08-27"],
        sourceData: expect.objectContaining({
          dayKey: "2026-08-27",
          streakCount: 7,
          streakLastDay: "2026-08-26",
        }),
      }),
    );
    expect(results).toHaveLength(1);
  });

  it("omite usuarios inactivos o que ya reclamaron hoy", async () => {
    userDocs.push(
      {
        id: "uid_claimed",
        data: () => ({
          streakCount: 4,
          streakLastDay: "2026-08-27",
        }),
      },
      {
        id: "uid_disabled",
        data: () => ({
          streakCount: 9,
          streakLastDay: "2026-08-26",
          activo: false,
        }),
      },
    );

    const results = await notificationSchedulerService.enqueueStreakReminders(now);

    expect(enqueueEventMock).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("omite rachas con conteo 0 aunque el lastDay coincida con ayer", async () => {
    userDocs.push({
      id: "uid_zero",
      data: () => ({
        streakCount: 0,
        streakLastDay: "2026-08-26",
      }),
    });

    const results = await notificationSchedulerService.enqueueStreakReminders(now);

    expect(enqueueEventMock).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});
