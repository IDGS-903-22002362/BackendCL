/**
 * Resolución del actor POS y autorización.
 *
 * El actor siempre se deriva del token verificado (`req.user`), nunca de datos enviados en
 * body o query. El rol POS se calcula desde el rol base y se refina con `posOperators/{uid}`.
 */

import { RolUsuario } from "../../../models/usuario.model";
import {
  capabilitiesForRole,
  hasCapability,
  isSelfApproval,
  resolvePosRole,
} from "../domain/capabilities";
import PosProblemError from "../errors/pos-problem.error";
import { PosCapability, PosRole } from "../models/pos.enums";
import type { PosActor } from "../models/pos.types";
import {
  posOperatorRepository,
  posUserDirectoryRepository,
} from "../repositories/pos-support.repository";

export interface AuthenticatedUserLike {
  uid: string;
  email?: string;
  nombre?: string;
  rol?: RolUsuario | string;
  activo?: boolean;
}

/** Cache corta por UID: cada request del POS resolvería el mismo documento. */
const OPERATOR_CACHE_TTL_MS = 15_000;
const operatorCache = new Map<
  string,
  { posRole: PosRole | null; active: boolean; expiresAt: number }
>();

export function clearOperatorCache(): void {
  operatorCache.clear();
}

class PosAuthorizationService {
  /**
   * Construye el actor POS. Lanza `POS_ACCESS_DENIED` cuando el usuario no pertenece al
   * personal habilitado o su registro de operador está desactivado.
   */
  async resolveActor(user: AuthenticatedUserLike): Promise<PosActor> {
    if (!user?.uid) {
      throw new PosProblemError("AUTHENTICATION_REQUIRED");
    }
    if (user.activo === false) {
      throw new PosProblemError(
        "POS_ACCESS_DENIED",
        "La cuenta está desactivada.",
      );
    }

    const baseRole = user.rol as RolUsuario | undefined;
    const operator = await this.loadOperator(user.uid);

    if (operator && operator.active === false) {
      throw new PosProblemError(
        "POS_ACCESS_DENIED",
        "El operador de punto de venta está desactivado.",
      );
    }

    const posRole = resolvePosRole(baseRole, operator?.posRole ?? null);
    if (!posRole || !baseRole) {
      throw new PosProblemError("POS_ACCESS_DENIED");
    }

    const capabilities = capabilitiesForRole(posRole);
    if (!capabilities.includes(PosCapability.ACCESS)) {
      throw new PosProblemError("POS_ACCESS_DENIED");
    }

    return {
      uid: user.uid,
      email: user.email,
      name: user.nombre,
      baseRole,
      posRole,
      capabilities,
    };
  }

  /**
   * Resuelve a otro operador por UID leyendo su registro real (directorio + `posOperators`).
   * Se usa para autorizadores y receptores: el cliente aporta el UID, nunca el rol.
   */
  async resolveActorByUid(uid: string): Promise<PosActor> {
    const user = await posUserDirectoryRepository.findByUid(uid);
    if (!user) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "El usuario indicado no existe.",
      );
    }
    return this.resolveActor({
      uid: user.uid,
      email: user.email,
      nombre: user.nombre,
      rol: user.rol,
      activo: user.activo,
    });
  }

  requireCapability(actor: PosActor, capability: PosCapability): void {
    if (!hasCapability(actor, capability)) {
      throw new PosProblemError(
        "POS_PERMISSION_DENIED",
        `Se requiere la capacidad ${capability}.`,
      );
    }
  }

  requireAnyCapability(
    actor: PosActor,
    capabilities: readonly PosCapability[],
  ): void {
    if (!capabilities.some((capability) => hasCapability(actor, capability))) {
      throw new PosProblemError("POS_PERMISSION_DENIED");
    }
  }

  /**
   * Ownership de recursos por cajero. Quien tiene lectura global puede ver todo; el resto
   * solo lo propio. Se responde 404 en lugar de 403 cuando el recurso pertenece a otro
   * cajero para no revelar su existencia (anti enumeración).
   */
  assertCanReadOwned(
    actor: PosActor,
    ownerUid: string | null | undefined,
    readAllCapability: PosCapability,
  ): void {
    if (hasCapability(actor, readAllCapability)) {
      return;
    }
    if (ownerUid && ownerUid === actor.uid) {
      return;
    }
    throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
  }

  /** Separación de responsabilidades: nadie autoriza lo que él mismo solicitó. */
  assertNotSelfApproval(actor: PosActor, requesterUid: string): void {
    if (isSelfApproval(actor.uid, requesterUid)) {
      throw new PosProblemError("SELF_APPROVAL_FORBIDDEN");
    }
  }

  /** Alcance de consulta: `null` significa sin filtro por cajero. */
  scopeCashierFilter(
    actor: PosActor,
    readAllCapability: PosCapability,
    requestedCashierUid?: string,
  ): string | null {
    if (hasCapability(actor, readAllCapability)) {
      return requestedCashierUid ?? null;
    }
    if (requestedCashierUid && requestedCashierUid !== actor.uid) {
      throw new PosProblemError("POS_PERMISSION_DENIED");
    }
    return actor.uid;
  }

  private async loadOperator(
    uid: string,
  ): Promise<{ posRole: PosRole | null; active: boolean } | null> {
    const cached = operatorCache.get(uid);
    if (cached && cached.expiresAt > Date.now()) {
      return { posRole: cached.posRole, active: cached.active };
    }

    const operator = await posOperatorRepository.get(uid);
    const resolved = operator
      ? { posRole: operator.posRole, active: operator.active }
      : null;

    operatorCache.set(uid, {
      posRole: resolved?.posRole ?? null,
      active: resolved?.active ?? true,
      expiresAt: Date.now() + OPERATOR_CACHE_TTL_MS,
    });

    return resolved;
  }
}

export const posAuthorizationService = new PosAuthorizationService();
export default posAuthorizationService;
