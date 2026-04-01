import { Timestamp } from "firebase-admin/firestore";

type OrderRecord = {
  id: string;
  usuarioId: string;
  estado: string;
  items: Array<{ productoId: string }>;
  deliveredAt?: Timestamp;
  updatedAt?: Timestamp;
  createdAt?: Timestamp;
};

type ProductRecord = {
  ratingSummary?: {
    average?: number;
    count?: number;
    updatedAt?: Timestamp;
  };
  ratingTotalScore?: number;
};

type RatingRecord = {
  productId: string;
  userId: string;
  score: number;
  eligibleOrderId: string;
  eligibleDeliveredAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

const ordersStore = new Map<string, OrderRecord>();
const productsStore = new Map<string, ProductRecord>();
const ratingsStore = new Map<string, RatingRecord>();

const createSnapshot = <T>(
  id: string,
  data?: T,
): FirebaseFirestore.DocumentSnapshot =>
  ({
    id,
    exists: data !== undefined,
    data: () => data,
  } as unknown as FirebaseFirestore.DocumentSnapshot);

const createDocRef = <T extends object>(
  collectionName: string,
  id: string,
  store: Map<string, T>,
) =>
  ({
    id,
    collectionName,
    async get() {
      return createSnapshot(id, store.get(id));
    },
  } as {
    id: string;
    collectionName: string;
    get: () => Promise<FirebaseFirestore.DocumentSnapshot>;
  });

const firestoreTiendaMock = {
  collection: jest.fn((collectionName: string) => {
    if (collectionName === "ordenes") {
      const filters: Array<{ field: string; value: string }> = [];
      const query = {
        where(field: string, _op: string, value: string) {
          filters.push({ field, value });
          return query;
        },
        orderBy() {
          return query;
        },
        async get() {
          const docs = Array.from(ordersStore.values())
            .filter((order) =>
              filters.every(({ field, value }) => (order as never)[field] === value),
            )
            .sort(
              (left, right) =>
                (right.createdAt?.toMillis?.() || 0) -
                (left.createdAt?.toMillis?.() || 0),
            )
            .map((order) => createSnapshot(order.id, order));

          return { docs };
        },
      };

      return query;
    }

    if (collectionName === "productos") {
      return {
        doc(id: string) {
          return createDocRef(collectionName, id, productsStore);
        },
      };
    }

    if (collectionName === "productRatings") {
      return {
        doc(id: string) {
          return createDocRef(collectionName, id, ratingsStore);
        },
      };
    }

    throw new Error(`Unexpected collection: ${collectionName}`);
  }),
  runTransaction: jest.fn(
    async (
      callback: (
        transaction: {
          get: (ref: { get: () => Promise<FirebaseFirestore.DocumentSnapshot> }) => Promise<FirebaseFirestore.DocumentSnapshot>;
          set: (ref: { id: string; collectionName: string }, data: RatingRecord) => void;
          update: (ref: { id: string; collectionName: string }, data: Record<string, unknown>) => void;
        },
      ) => Promise<unknown>,
    ) => {
      const transaction = {
        get: (ref: { get: () => Promise<FirebaseFirestore.DocumentSnapshot> }) =>
          ref.get(),
        set: (ref: { id: string; collectionName: string }, data: RatingRecord) => {
          if (ref.collectionName === "productRatings") {
            ratingsStore.set(ref.id, data);
          }
        },
        update: (
          ref: { id: string; collectionName: string },
          data: Record<string, unknown>,
        ) => {
          if (ref.collectionName === "productos") {
            const current = productsStore.get(ref.id) || {};
            productsStore.set(ref.id, {
              ...current,
              ...data,
            });
          }
        },
      };

      return callback(transaction);
    },
  ),
};

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: firestoreTiendaMock,
}));

import productRatingService from "../src/services/product-rating.service";

describe("productRatingService", () => {
  beforeEach(() => {
    ordersStore.clear();
    productsStore.clear();
    ratingsStore.clear();
    jest.clearAllMocks();
  });

  it("crea una nueva calificacion y actualiza el resumen del producto", async () => {
    const deliveredAt = Timestamp.fromDate(new Date("2026-03-29T12:00:00.000Z"));
    ordersStore.set("order_1", {
      id: "order_1",
      usuarioId: "uid_1",
      estado: "ENTREGADA",
      items: [{ productoId: "prod_1" }],
      deliveredAt,
      updatedAt: deliveredAt,
      createdAt: deliveredAt,
    });
    productsStore.set("prod_1", {
      ratingSummary: {
        average: 0,
        count: 0,
      },
      ratingTotalScore: 0,
    });

    const result = await productRatingService.upsertProductRating(
      "prod_1",
      "uid_1",
      5,
    );

    expect(result.created).toBe(true);
    expect(result.rating.score).toBe(5);
    expect(ratingsStore.get("prod_1__uid_1")?.eligibleOrderId).toBe("order_1");
    expect(productsStore.get("prod_1")).toMatchObject({
      ratingTotalScore: 5,
      ratingSummary: {
        average: 5,
        count: 1,
      },
    });
  });

  it("actualiza una calificacion existente sin incrementar el conteo", async () => {
    const deliveredAt = Timestamp.fromDate(new Date("2026-03-28T12:00:00.000Z"));
    const createdAt = Timestamp.fromDate(new Date("2026-03-28T13:00:00.000Z"));

    ordersStore.set("order_2", {
      id: "order_2",
      usuarioId: "uid_2",
      estado: "ENTREGADA",
      items: [{ productoId: "prod_2" }],
      deliveredAt,
      updatedAt: deliveredAt,
      createdAt: deliveredAt,
    });
    productsStore.set("prod_2", {
      ratingSummary: {
        average: 2,
        count: 1,
        updatedAt: createdAt,
      },
      ratingTotalScore: 2,
    });
    ratingsStore.set("prod_2__uid_2", {
      productId: "prod_2",
      userId: "uid_2",
      score: 2,
      eligibleOrderId: "order_2",
      eligibleDeliveredAt: deliveredAt,
      createdAt,
      updatedAt: createdAt,
    });

    const result = await productRatingService.upsertProductRating(
      "prod_2",
      "uid_2",
      4,
    );

    expect(result.created).toBe(false);
    expect(ratingsStore.get("prod_2__uid_2")?.score).toBe(4);
    expect(productsStore.get("prod_2")).toMatchObject({
      ratingTotalScore: 4,
      ratingSummary: {
        average: 4,
        count: 1,
      },
    });
  });

  it("reporta not_delivered cuando existe compra pero no entregada", async () => {
    const createdAt = Timestamp.fromDate(new Date("2026-03-30T12:00:00.000Z"));
    ordersStore.set("order_3", {
      id: "order_3",
      usuarioId: "uid_3",
      estado: "ENVIADA",
      items: [{ productoId: "prod_3" }],
      updatedAt: createdAt,
      createdAt,
    });

    const result = await productRatingService.getRatingEligibility(
      "prod_3",
      "uid_3",
    );

    expect(result).toEqual({
      canRate: false,
      reason: "not_delivered",
    });
  });
});
