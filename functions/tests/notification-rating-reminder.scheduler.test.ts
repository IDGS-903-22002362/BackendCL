import { Timestamp } from "firebase-admin/firestore";

const orderDocs: Array<{
  id: string;
  data: () => Record<string, unknown>;
}> = [];
const productDocs = new Map<string, Record<string, unknown>>();
const enqueueEventMock = jest.fn();
const hasUserRatedProductMock = jest.fn();

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: jest.fn((collectionName: string) => {
      if (collectionName === "ordenes") {
        const query: {
          where: jest.Mock;
          limit: jest.Mock;
          get: () => Promise<{ size: number; docs: typeof orderDocs }>;
        } = {
          where: jest.fn(() => query),
          limit: jest.fn(() => query),
          async get() {
            return {
              size: orderDocs.length,
              docs: orderDocs,
            };
          },
        };

        return query;
      }

      if (collectionName === "productos") {
        return {
          doc(productId: string) {
            return {
              async get() {
                const data = productDocs.get(productId);
                return {
                  exists: Boolean(data),
                  data: () => data,
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected collection: ${collectionName}`);
    }),
  },
}));

jest.mock("../src/services/notifications/notification-event.service", () => ({
  __esModule: true,
  default: {
    enqueueEvent: enqueueEventMock,
  },
}));

jest.mock("../src/services/product-rating.service", () => ({
  __esModule: true,
  default: {
    hasUserRatedProduct: hasUserRatedProductMock,
  },
}));

import notificationSchedulerService from "../src/services/notifications/notification-scheduler.service";

describe("notificationSchedulerService enqueueProductRatingReminders", () => {
  beforeEach(() => {
    orderDocs.length = 0;
    productDocs.clear();
    enqueueEventMock.mockReset();
    hasUserRatedProductMock.mockReset();
  });

  it("encola recordatorios para productos entregados sin calificacion previa", async () => {
    const deliveredAt = Timestamp.fromDate(new Date("2026-03-29T12:00:00.000Z"));

    orderDocs.push({
      id: "order_1",
      data: () => ({
        usuarioId: "uid_1",
        items: [{ productoId: "prod_1" }, { productoId: "prod_1" }],
        deliveredAt,
      }),
    });
    productDocs.set("prod_1", {
      descripcion: "Jersey Oficial",
    });
    hasUserRatedProductMock.mockResolvedValue(false);
    enqueueEventMock.mockResolvedValue({
      event: {
        id: "event_1",
      },
      created: true,
    });

    const results =
      await notificationSchedulerService.enqueueProductRatingReminders();

    expect(hasUserRatedProductMock).toHaveBeenCalledWith("prod_1", "uid_1");
    expect(enqueueEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "product_rating_reminder",
        userId: "uid_1",
        productId: "prod_1",
        orderId: "order_1",
        triggerSource: "scheduler_product_rating_reminder",
      }),
    );
    expect(results).toHaveLength(1);
  });

  it("omite productos que el usuario ya califico", async () => {
    const deliveredAt = Timestamp.fromDate(new Date("2026-03-29T12:00:00.000Z"));

    orderDocs.push({
      id: "order_2",
      data: () => ({
        usuarioId: "uid_2",
        items: [{ productoId: "prod_2" }],
        deliveredAt,
      }),
    });
    hasUserRatedProductMock.mockResolvedValue(true);

    const results =
      await notificationSchedulerService.enqueueProductRatingReminders();

    expect(enqueueEventMock).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});
