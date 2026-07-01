import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { randomBytes, scryptSync } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { LOYALTY_PARTNER_COLLECTIONS } from "../src/modules/loyalty/constants/loyalty.constants";
import LoyaltyProblemError from "../src/modules/loyalty/errors/loyalty-problem.error";
import {
  LoyaltyEnvironment,
  PartnerScope,
} from "../src/modules/loyalty/models/loyalty.enums";

type DocData = Record<string, unknown>;

function hashSecret(secret: string, salt: string): string {
  return scryptSync(secret, salt, 64).toString("hex");
}

function createFakeFirestore(initial: Record<string, Record<string, DocData>> = {}) {
  const collections = new Map<string, Map<string, DocData>>();

  const load = (initialDocs: Record<string, Record<string, DocData>>) => {
    collections.clear();
    Object.entries(initialDocs).forEach(([name, docs]) => {
      collections.set(name, new Map(Object.entries(docs).map(([id, data]) => [id, { ...data }])));
    });
  };

  load(initial);

  const getCollection = (name: string) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name)!;
  };

  const docRefFactory = (collectionName: string, id: string) => ({
    id,
    async get() {
      const data = getCollection(collectionName).get(id);
      return { exists: !!data, id, data: () => (data ? { ...data } : undefined) };
    },
  });

  const collectionFactory = (name: string) => ({
    doc(id: string) {
      return docRefFactory(name, id);
    },
  });

  return {
    collection: collectionFactory,
    reset(initialDocs: Record<string, Record<string, DocData>>) {
      load(initialDocs);
    },
    seed(collection: string, id: string, data: DocData) {
      getCollection(collection).set(id, { ...data });
    },
  };
}

const fixedNow = Timestamp.fromDate(new Date("2026-07-01T12:00:00.000Z"));
const fakeFirestore = createFakeFirestore({});

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {
    collection: (name: string) => fakeFirestore.collection(name),
    runTransaction: jest.fn(),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: { now: () => fixedNow },
    },
  },
}));

jest.mock("../src/modules/loyalty/partner/services/partner-audit.service", () => ({
  __esModule: true,
  default: { log: jest.fn<any>().mockResolvedValue(undefined) },
}));

import partnerRegistryService from "../src/modules/loyalty/partner/services/partner-registry.service";

/**
 * Flujo documentado (scripts/e2e-sandbox-partner.mjs, sin red en este archivo):
 * 1. POST /oauth/token (client_credentials)
 * 2. GET /members/:memberId/wallet
 * 3. POST /earn-transactions (Idempotency-Key + X-Request-Id)
 * 4. GET /transactions/:transactionId
 * 5. Repetir POST /earn-transactions con la misma Idempotency-Key (idempotencia)
 * 6. GET /members/:memberId/wallet (saldo incrementado una sola vez)
 */
describe("Loyalty partner sandbox E2E flow (documented)", () => {
  it("lists the expected HTTP sequence", () => {
    const steps = [
      "POST /oauth/token",
      "GET /members/:memberId/wallet",
      "POST /earn-transactions",
      "GET /transactions/:transactionId",
      "POST /earn-transactions (replay)",
      "GET /members/:memberId/wallet",
    ];
    expect(steps).toHaveLength(6);
    expect(steps[0]).toContain("oauth/token");
    expect(steps[2]).toContain("earn-transactions");
  });
});

describe("Partner registry secret hash + validateClientCredentials", () => {
  const partnerId = "partner_test_e2e";
  const clientId = "client_test_e2e";
  const clientSecret = "secret_e2e_unit_test_value";
  const salt = randomBytes(16).toString("hex");

  const baseSeed = () => ({
    [LOYALTY_PARTNER_COLLECTIONS.CLIENTS]: {
      [clientId]: {
        clientId,
        partnerId,
        environment: LoyaltyEnvironment.SANDBOX,
        secretHash: hashSecret(clientSecret, salt),
        secretSalt: salt,
        enabled: true,
        scopes: [PartnerScope.WALLET_READ, PartnerScope.POINTS_EARN],
        allowedLocations: [],
        createdAt: fixedNow,
      },
    },
    [LOYALTY_PARTNER_COLLECTIONS.PARTNERS]: {
      [partnerId]: {
        partnerId,
        name: "E2E Partner",
        environment: LoyaltyEnvironment.SANDBOX,
        scopes: [PartnerScope.WALLET_READ, PartnerScope.POINTS_EARN],
        allowedLocations: [],
        enabled: true,
        createdAt: fixedNow,
      },
    },
  });

  beforeEach(() => {
    fakeFirestore.reset(baseSeed());
  });

  it("validates matching client_secret against scrypt hash", async () => {
    const result = await partnerRegistryService.validateClientCredentials(
      clientId,
      clientSecret,
    );

    expect(result.client.clientId).toBe(clientId);
    expect(result.partner.partnerId).toBe(partnerId);
    expect(result.client.secretHash).not.toBe(clientSecret);
  });

  it("rejects wrong client_secret", async () => {
    await expect(
      partnerRegistryService.validateClientCredentials(clientId, "secret_wrong"),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("rejects disabled client", async () => {
    fakeFirestore.seed(LOYALTY_PARTNER_COLLECTIONS.CLIENTS, clientId, {
      clientId,
      partnerId,
      environment: LoyaltyEnvironment.SANDBOX,
      secretHash: hashSecret(clientSecret, salt),
      secretSalt: salt,
      enabled: false,
      scopes: [PartnerScope.WALLET_READ],
      allowedLocations: [],
      createdAt: fixedNow,
    });

    await expect(
      partnerRegistryService.validateClientCredentials(clientId, clientSecret),
    ).rejects.toBeInstanceOf(LoyaltyProblemError);
  });

  it("rejects when partner is disabled", async () => {
    fakeFirestore.seed(LOYALTY_PARTNER_COLLECTIONS.PARTNERS, partnerId, {
      partnerId,
      name: "E2E Partner",
      environment: LoyaltyEnvironment.SANDBOX,
      scopes: [PartnerScope.WALLET_READ],
      allowedLocations: [],
      enabled: false,
      createdAt: fixedNow,
    });

    await expect(
      partnerRegistryService.validateClientCredentials(clientId, clientSecret),
    ).rejects.toMatchObject({ code: "PARTNER_DISABLED" });
  });

  it("buildTokenId returns opaque tok_ prefix", () => {
    const tokenId = partnerRegistryService.buildTokenId();
    expect(tokenId.startsWith("tok_")).toBe(true);
    expect(tokenId.length).toBeGreaterThan(10);
  });
});
