import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../config/firebase";
import { ProductRatingSummary } from "../models/producto.model";
import {
  ProductRating,
  ProductRatingEligibility,
  ProductRatingEligibilityReason,
  ProductUserRatingSnapshot,
} from "../models/product-rating.model";

const PRODUCTOS_COLLECTION = "productos";
const ORDENES_COLLECTION = "ordenes";
const PRODUCT_RATINGS_COLLECTION = "productRatings";
const DEFAULT_RATING_SUMMARY: ProductRatingSummary = {
  average: 0,
  count: 0,
};

interface EligibleDeliveredOrder {
  orderId: string;
  deliveredAt: Timestamp;
}

class ProductRatingService {
  private buildRatingId(productId: string, userId: string): string {
    return `${productId}__${userId}`;
  }

  private extractRatingSummary(data: FirebaseFirestore.DocumentData): {
    count: number;
    totalScore: number;
  } {
    const summaryRaw =
      typeof data.ratingSummary === "object" && data.ratingSummary !== null
        ? (data.ratingSummary as { count?: unknown; average?: unknown })
        : null;
    const countRaw = Number(summaryRaw?.count ?? DEFAULT_RATING_SUMMARY.count);
    const count =
      Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 0;
    const averageRaw = Number(summaryRaw?.average ?? DEFAULT_RATING_SUMMARY.average);
    const average =
      Number.isFinite(averageRaw) && averageRaw > 0 ? averageRaw : 0;
    const totalScoreRaw = Number(data.ratingTotalScore ?? 0);
    const totalScore =
      Number.isFinite(totalScoreRaw) && totalScoreRaw > 0
        ? totalScoreRaw
        : count > 0
          ? average * count
          : 0;

    return { count, totalScore };
  }

  private toRatingSnapshot(
    snapshot: FirebaseFirestore.DocumentSnapshot,
  ): ProductRating | null {
    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() as ProductRating;
    return {
      id: snapshot.id,
      ...data,
    };
  }

  private async findEligibleDeliveredOrder(
    userId: string,
    productId: string,
  ): Promise<{
    order: EligibleDeliveredOrder | null;
    reason: ProductRatingEligibilityReason;
  }> {
    const snapshot = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .where("usuarioId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();

    let hasNonCancelledPurchase = false;

    for (const doc of snapshot.docs) {
      const data = doc.data() as {
        estado?: string;
        items?: Array<{ productoId?: string }>;
        deliveredAt?: Timestamp;
        updatedAt?: Timestamp;
      };

      const containsProduct = Array.isArray(data.items)
        ? data.items.some((item) => item.productoId === productId)
        : false;

      if (!containsProduct) {
        continue;
      }

      if (data.estado === "ENTREGADA") {
        return {
          order: {
            orderId: doc.id,
            deliveredAt: data.deliveredAt || data.updatedAt || Timestamp.now(),
          },
          reason: "eligible",
        };
      }

      if (data.estado !== "CANCELADA") {
        hasNonCancelledPurchase = true;
      }
    }

    return {
      order: null,
      reason: hasNonCancelledPurchase ? "not_delivered" : "purchase_required",
    };
  }

  async getRatingEligibility(
    productId: string,
    userId: string,
  ): Promise<ProductRatingEligibility> {
    const eligibility = await this.findEligibleDeliveredOrder(userId, productId);

    return {
      canRate: eligibility.reason === "eligible",
      reason: eligibility.reason,
    };
  }

  async getUserRating(
    productId: string,
    userId: string,
  ): Promise<ProductUserRatingSnapshot | null> {
    const snapshot = await firestoreTienda
      .collection(PRODUCT_RATINGS_COLLECTION)
      .doc(this.buildRatingId(productId, userId))
      .get();
    const rating = this.toRatingSnapshot(snapshot);

    if (!rating) {
      return null;
    }

    return {
      score: rating.score,
      updatedAt: rating.updatedAt,
    };
  }

  async hasUserRatedProduct(productId: string, userId: string): Promise<boolean> {
    const snapshot = await firestoreTienda
      .collection(PRODUCT_RATINGS_COLLECTION)
      .doc(this.buildRatingId(productId, userId))
      .get();

    return snapshot.exists;
  }

  async upsertProductRating(
    productId: string,
    userId: string,
    score: number,
  ): Promise<{ created: boolean; rating: ProductRating }> {
    const eligibleOrder = await this.findEligibleDeliveredOrder(userId, productId);

    if (!eligibleOrder.order) {
      throw new Error(
        eligibleOrder.reason === "not_delivered"
          ? "Solo puedes calificar productos que ya fueron entregados"
          : "Solo puedes calificar productos que hayas comprado anteriormente",
      );
    }
    const eligibleDeliveredOrder = eligibleOrder.order;

    const ratingId = this.buildRatingId(productId, userId);
    const ratingRef = firestoreTienda
      .collection(PRODUCT_RATINGS_COLLECTION)
      .doc(ratingId);
    const productRef = firestoreTienda.collection(PRODUCTOS_COLLECTION).doc(productId);
    const now = Timestamp.now();

    const transactionResult = await firestoreTienda.runTransaction(
      async (transaction) => {
        const [productSnapshot, ratingSnapshot] = await Promise.all([
          transaction.get(productRef),
          transaction.get(ratingRef),
        ]);

        if (!productSnapshot.exists) {
          throw new Error(`Producto con ID ${productId} no encontrado`);
        }

        const productData = productSnapshot.data() || {};
        const currentSummary = this.extractRatingSummary(productData);
        const currentRating = this.toRatingSnapshot(ratingSnapshot);
        const created = !currentRating;
        const nextCount = created
          ? currentSummary.count + 1
          : currentSummary.count;
        const nextTotalScore = created
          ? currentSummary.totalScore + score
          : currentSummary.totalScore - currentRating.score + score;
        const nextAverage =
          nextCount > 0 ? Number((nextTotalScore / nextCount).toFixed(2)) : 0;

        const rating: ProductRating = {
          id: ratingId,
          productId,
          userId,
          score,
          eligibleOrderId: eligibleDeliveredOrder.orderId,
          eligibleDeliveredAt: eligibleDeliveredOrder.deliveredAt,
          createdAt: currentRating?.createdAt || now,
          updatedAt: now,
        };

        transaction.set(ratingRef, {
          productId: rating.productId,
          userId: rating.userId,
          score: rating.score,
          eligibleOrderId: rating.eligibleOrderId,
          eligibleDeliveredAt: rating.eligibleDeliveredAt,
          createdAt: rating.createdAt,
          updatedAt: rating.updatedAt,
        });
        transaction.update(productRef, {
          ratingSummary: {
            average: nextAverage,
            count: nextCount,
            updatedAt: now,
          },
          ratingTotalScore: nextTotalScore,
        });

        return {
          created,
          rating,
        };
      },
    );

    return transactionResult;
  }
}

export const productRatingService = new ProductRatingService();
export default productRatingService;
