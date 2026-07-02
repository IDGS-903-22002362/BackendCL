import jwt from "jsonwebtoken";
import { LOYALTY_DEFAULTS } from "../../constants/loyalty.constants";
import LoyaltyProblemError from "../../errors/loyalty-problem.error";
import { LoyaltyEnvironment } from "../../models/loyalty.enums";
import { PartnerAuthContext, PartnerTokenClaims } from "../partner.types";
import partnerRegistryService from "./partner-registry.service";

function getJwtSecret(): string {
  const secret =
    process.env.LOYALTY_PARTNER_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("LOYALTY_PARTNER_JWT_SECRET is not configured");
  }
  return secret;
}

export class PartnerOAuthService {
  async issueToken(input: {
    clientId: string;
    clientSecret: string;
    grantType: string;
    /** Ambiente del endpoint que recibe la petición (sandbox o producción). */
    expectedEnvironment?: LoyaltyEnvironment;
  }): Promise<{
    access_token: string;
    token_type: "Bearer";
    expires_in: number;
    scope: string;
  }> {
    if (input.grantType !== "client_credentials") {
      throw new LoyaltyProblemError(
        "AUTHENTICATION_REQUIRED",
        "grant_type debe ser client_credentials",
      );
    }

    const { client, partner } = await partnerRegistryService.validateClientCredentials(
      input.clientId,
      input.clientSecret,
    );

    // Credenciales sandbox no emiten token en el endpoint de producción y
    // viceversa: el aislamiento se aplica desde la emisión, no solo en el uso.
    if (
      input.expectedEnvironment &&
      partner.environment !== input.expectedEnvironment
    ) {
      throw new LoyaltyProblemError(
        "AUTHENTICATION_REQUIRED",
        "Las credenciales no corresponden a este ambiente",
      );
    }

    const tokenId = partnerRegistryService.buildTokenId();
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = LOYALTY_DEFAULTS.PARTNER_TOKEN_TTL_SECONDS;

    const claims: PartnerTokenClaims = {
      clientId: client.clientId,
      partnerId: partner.partnerId,
      environment: partner.environment,
      scopes: client.scopes,
      allowedLocations: client.allowedLocations,
      tokenId,
      iat: now,
      exp: now + expiresIn,
    };

    const accessToken = jwt.sign(claims, getJwtSecret(), {
      algorithm: "HS256",
      issuer: "clubleon-loyalty-api",
      audience: partner.environment === LoyaltyEnvironment.SANDBOX
        ? "loyalty-sandbox"
        : "loyalty-production",
      // Claim estándar jti (mismo valor que tokenId) para trazabilidad/revocación.
      jwtid: tokenId,
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: client.scopes.join(" "),
    };
  }

  verifyToken(token: string, expectedEnvironment: LoyaltyEnvironment): PartnerAuthContext {
    try {
      const decoded = jwt.verify(token, getJwtSecret(), {
        algorithms: ["HS256"],
        issuer: "clubleon-loyalty-api",
      }) as PartnerTokenClaims;

      if (decoded.environment !== expectedEnvironment) {
        throw new LoyaltyProblemError("INVALID_TOKEN");
      }

      return {
        clientId: decoded.clientId,
        partnerId: decoded.partnerId,
        environment: decoded.environment,
        scopes: decoded.scopes,
        allowedLocations: decoded.allowedLocations ?? [],
        tokenId: decoded.tokenId,
      };
    } catch (error) {
      if (error instanceof LoyaltyProblemError) {
        throw error;
      }
      if (error instanceof jwt.TokenExpiredError) {
        throw new LoyaltyProblemError("TOKEN_EXPIRED");
      }
      throw new LoyaltyProblemError("INVALID_TOKEN");
    }
  }
}

export const partnerOAuthService = new PartnerOAuthService();
export default partnerOAuthService;
