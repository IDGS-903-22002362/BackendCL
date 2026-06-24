import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firestoreApp } from "../config/app.firebase";

const RATE_LIMIT_COLLECTION = "_rateLimits";

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

function hashRateLimitKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function isDistributedRateLimitEnabled(): boolean {
  if (process.env.RATE_LIMIT_DISTRIBUTED === "false") {
    return false;
  }

  return (
    process.env.RATE_LIMIT_DISTRIBUTED === "true" ||
    Boolean(process.env.K_SERVICE || process.env.FUNCTION_NAME)
  );
}

export async function consumeDistributedRateLimit(
  key: string,
  windowMs: number,
  maxRequests: number,
): Promise<RateLimitDecision> {
  const docRef = firestoreApp
    .collection(RATE_LIMIT_COLLECTION)
    .doc(hashRateLimitKey(key));
  const now = Date.now();

  return firestoreApp.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);

    if (!snap.exists) {
      tx.set(docRef, {
        count: 1,
        expiresAt: now + windowMs,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { allowed: true };
    }

    const data = snap.data() as { count?: number; expiresAt?: number };
    const expiresAt = Number(data.expiresAt ?? 0);
    const count = Number(data.count ?? 0);

    if (expiresAt <= now) {
      tx.set(docRef, {
        count: 1,
        expiresAt: now + windowMs,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { allowed: true };
    }

    if (count >= maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - now) / 1000)),
      };
    }

    tx.update(docRef, {
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { allowed: true };
  });
}
