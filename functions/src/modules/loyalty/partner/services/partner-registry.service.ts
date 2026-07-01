import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { firestoreApp } from "../../../../config/app.firebase";
import { admin } from "../../../../config/firebase.admin";
import { LOYALTY_PARTNER_COLLECTIONS } from "../../constants/loyalty.constants";
import LoyaltyProblemError from "../../errors/loyalty-problem.error";
import { LoyaltyEnvironment, PartnerScope } from "../../models/loyalty.enums";
import {
  PartnerClientRecord,
  PartnerRecord,
} from "../partner.types";
import partnerAuditService from "./partner-audit.service";

function hashSecret(secret: string, salt: string): string {
  return scryptSync(secret, salt, 64).toString("hex");
}

function generateClientId(environment: LoyaltyEnvironment): string {
  const prefix = environment === LoyaltyEnvironment.SANDBOX ? "client_test" : "client_live";
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function generatePartnerId(environment: LoyaltyEnvironment): string {
  const prefix = environment === LoyaltyEnvironment.SANDBOX ? "partner_test" : "partner_live";
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function generateSecret(): string {
  return `secret_${randomBytes(24).toString("hex")}`;
}

export class PartnerRegistryService {
  private partners = firestoreApp.collection(LOYALTY_PARTNER_COLLECTIONS.PARTNERS);
  private clients = firestoreApp.collection(LOYALTY_PARTNER_COLLECTIONS.CLIENTS);

  async createPartner(input: {
    name: string;
    environment: LoyaltyEnvironment;
    scopes: PartnerScope[];
    allowedLocations?: string[];
    actorId?: string;
  }): Promise<{ partner: PartnerRecord; clientId: string; clientSecret: string }> {
    const partnerId = generatePartnerId(input.environment);
    const clientId = generateClientId(input.environment);
    const clientSecret = generateSecret();
    const salt = randomBytes(16).toString("hex");
    const now = admin.firestore.Timestamp.now();

    const partner: PartnerRecord = {
      partnerId,
      name: input.name,
      environment: input.environment,
      scopes: input.scopes,
      allowedLocations: input.allowedLocations ?? [],
      enabled: true,
      createdAt: now,
    };

    const client: PartnerClientRecord = {
      clientId,
      partnerId,
      environment: input.environment,
      secretHash: hashSecret(clientSecret, salt),
      secretSalt: salt,
      enabled: true,
      scopes: input.scopes,
      allowedLocations: input.allowedLocations ?? [],
      createdAt: now,
    };

    await firestoreApp.runTransaction(async (tx) => {
      tx.set(this.partners.doc(partnerId), partner);
      tx.set(this.clients.doc(clientId), client);
    });

    await partnerAuditService.log({
      action: "partner.created",
      partnerId,
      clientId,
      actorId: input.actorId ?? "cli",
      details: { name: input.name, environment: input.environment, scopes: input.scopes },
    });

    return { partner, clientId, clientSecret };
  }

  async getPartner(partnerId: string): Promise<PartnerRecord | null> {
    const snap = await this.partners.doc(partnerId).get();
    if (!snap.exists) return null;
    return snap.data() as PartnerRecord;
  }

  async getClient(clientId: string): Promise<PartnerClientRecord | null> {
    const snap = await this.clients.doc(clientId).get();
    if (!snap.exists) return null;
    return snap.data() as PartnerClientRecord;
  }

  async validateClientCredentials(
    clientId: string,
    clientSecret: string,
  ): Promise<{ client: PartnerClientRecord; partner: PartnerRecord }> {
    const client = await this.getClient(clientId);
    if (!client || !client.enabled || client.revokedAt) {
      throw new LoyaltyProblemError("AUTHENTICATION_REQUIRED");
    }

    const computed = hashSecret(clientSecret, client.secretSalt);
    const valid = timingSafeEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(client.secretHash, "hex"),
    );
    if (!valid) {
      throw new LoyaltyProblemError("AUTHENTICATION_REQUIRED");
    }

    const partner = await this.getPartner(client.partnerId);
    if (!partner || !partner.enabled) {
      throw new LoyaltyProblemError("PARTNER_DISABLED");
    }

    return { client, partner };
  }

  async rotateClientSecret(clientId: string, actorId = "cli"): Promise<string> {
    const client = await this.getClient(clientId);
    if (!client || !client.enabled) {
      throw new LoyaltyProblemError("AUTHENTICATION_REQUIRED");
    }
    const clientSecret = generateSecret();
    const salt = randomBytes(16).toString("hex");
    await this.clients.doc(clientId).update({
      secretHash: hashSecret(clientSecret, salt),
      secretSalt: salt,
      rotatedAt: admin.firestore.Timestamp.now(),
    });
    await partnerAuditService.log({
      action: "client.rotated",
      partnerId: client.partnerId,
      clientId,
      actorId,
    });
    return clientSecret;
  }

  async revokeClient(clientId: string, actorId = "cli"): Promise<void> {
    const client = await this.getClient(clientId);
    if (!client) {
      throw new LoyaltyProblemError("AUTHENTICATION_REQUIRED");
    }
    await this.clients.doc(clientId).update({
      enabled: false,
      revokedAt: admin.firestore.Timestamp.now(),
    });
    await partnerAuditService.log({
      action: "client.revoked",
      partnerId: client.partnerId,
      clientId,
      actorId,
    });
  }

  async disablePartner(partnerId: string, actorId = "cli"): Promise<void> {
    const partner = await this.getPartner(partnerId);
    if (!partner) {
      throw new LoyaltyProblemError("AUTHENTICATION_REQUIRED");
    }
    await this.partners.doc(partnerId).update({
      enabled: false,
      updatedAt: admin.firestore.Timestamp.now(),
    });
    await partnerAuditService.log({
      action: "partner.disabled",
      partnerId,
      actorId,
    });
  }

  buildTokenId(): string {
    return `tok_${createHash("sha256").update(uuidv4()).digest("hex").slice(0, 24)}`;
  }
}

export const partnerRegistryService = new PartnerRegistryService();
export default partnerRegistryService;
