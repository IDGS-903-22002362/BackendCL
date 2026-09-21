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
        orderBy: jest.Mock;
        limit: jest.Mock;
        startAfter: jest.Mock;
        get: () => Promise<{ empty: boolean; size: number; docs: typeof userDocs }>;
      } = {
        where: jest.fn(() => query),
        orderBy: jest.fn(() => query),
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

describe("notificationSchedulerService enqueueBirthdayNotifications", () => {
  const now = new Date("2026-08-31T12:05:00.000-06:00");

  beforeEach(() => {
    userDocs.length = 0;
    enqueueEventMock.mockReset();
  });

  it("encola felicitaciones para cumpleañeros de hoy en hora de México", async () => {
    userDocs.push(
      {
        id: "uid_1",
        data: () => ({
          uid: "uid_1",
          nombre: "Ignacio Sánchez",
          fechaNacimiento: "1999-08-31",
        }),
      },
      {
        id: "uid_iso",
        data: () => ({
          fechaNacimiento: "2001-08-31T00:00:00.000Z",
        }),
      },
      {
        id: "uid_other_day",
        data: () => ({
          fechaNacimiento: "1999-08-30",
        }),
      },
    );
    enqueueEventMock.mockResolvedValue({
      event: { id: "event_1" },
      created: true,
    });

    const results = await notificationSchedulerService.enqueueBirthdayNotifications(
      now,
    );

    expect(enqueueEventMock).toHaveBeenCalledTimes(2);
    expect(enqueueEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "birthday",
        userId: "uid_1",
        triggerSource: "scheduler_birthday",
        fingerprintParts: ["birthday", "uid_1", "2026"],
        sourceData: expect.objectContaining({
          firstName: "Ignacio",
          dayKey: "2026-08-31",
          yearKey: "2026",
        }),
      }),
    );
    expect(results).toHaveLength(2);
  });

  it("omite usuarios inactivos o sin fecha de nacimiento", async () => {
    userDocs.push(
      {
        id: "uid_disabled",
        data: () => ({
          fechaNacimiento: "1999-08-31",
          activo: false,
        }),
      },
      {
        id: "uid_empty",
        data: () => ({
          fechaNacimiento: null,
        }),
      },
    );

    const results = await notificationSchedulerService.enqueueBirthdayNotifications(
      now,
    );

    expect(enqueueEventMock).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});
