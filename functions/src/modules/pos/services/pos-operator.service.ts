/**
 * Administración de operadores POS (`posOperators/{uid}`).
 *
 * Refina el rol operativo de un `EMPLEADO` del ecommerce (DEC-07). No crea usuarios ni
 * altera `RolUsuario`: solo asigna CASHIER / SENIOR_CASHIER / SUPERVISOR.
 */

import { RolUsuario } from "../../../models/usuario.model";
import { ASSIGNABLE_POS_ROLES, PosCapability, PosRole } from "../models/pos.enums";
import PosProblemError from "../errors/pos-problem.error";
import type { PosActor, PosOperator } from "../models/pos.types";
import {
  clearOperatorCache,
  posAuthorizationService,
} from "./pos-authorization.service";
import {
  posOperatorRepository,
  posUserDirectoryRepository,
} from "../repositories/pos-support.repository";

export interface UpsertOperatorInput {
  uid: string;
  posRole: PosRole;
  active: boolean;
  defaultRegisterId?: string | null;
}

export interface OperatorView extends PosOperator {
  email?: string;
  name?: string;
  baseRole?: string;
  resolvedPosRole: PosRole;
}

class PosOperatorService {
  async list(actor: PosActor, limit = 100): Promise<OperatorView[]> {
    posAuthorizationService.requireCapability(actor, PosCapability.CONFIG_MANAGE);
    const operators = await posOperatorRepository.list(Math.min(limit, 200));
    return Promise.all(operators.map((operator) => this.toView(operator)));
  }

  async get(actor: PosActor, uid: string): Promise<OperatorView> {
    posAuthorizationService.requireCapability(actor, PosCapability.CONFIG_MANAGE);
    const operator = await posOperatorRepository.get(uid);
    if (!operator) {
      throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
    }
    return this.toView(operator);
  }

  async upsert(
    actor: PosActor,
    input: UpsertOperatorInput,
  ): Promise<{ previous: PosOperator | null; next: PosOperator; view: OperatorView }> {
    posAuthorizationService.requireCapability(actor, PosCapability.CONFIG_MANAGE);

    if (!ASSIGNABLE_POS_ROLES.includes(input.posRole)) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "Solo se pueden asignar CASHIER, SENIOR_CASHIER o SUPERVISOR.",
      );
    }

    const user = await posUserDirectoryRepository.findByUid(input.uid);
    if (!user) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "El usuario indicado no existe.",
      );
    }
    if (user.rol !== RolUsuario.EMPLEADO) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "Solo se puede asignar rol POS a usuarios con rol base EMPLEADO. ADMIN y SUPER_ADMIN se derivan del rol base.",
      );
    }
    if (user.activo === false) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "El usuario está desactivado.",
      );
    }

    const previous = await posOperatorRepository.get(input.uid);
    const next = await posOperatorRepository.upsert({
      uid: input.uid,
      posRole: input.posRole,
      active: input.active,
      defaultRegisterId: input.defaultRegisterId ?? null,
      updatedBy: actor.uid,
    });
    clearOperatorCache();
    return { previous, next, view: await this.toView(next) };
  }

  private async toView(operator: PosOperator): Promise<OperatorView> {
    const user = await posUserDirectoryRepository.findByUid(operator.uid);
    const resolvedPosRole =
      user?.rol === RolUsuario.SUPER_ADMIN
        ? PosRole.SUPER_ADMIN
        : user?.rol === RolUsuario.ADMIN
          ? PosRole.ADMIN
          : operator.posRole;

    return {
      ...operator,
      email: user?.email,
      name: user?.nombre,
      baseRole: user?.rol,
      resolvedPosRole,
    };
  }
}

export const posOperatorService = new PosOperatorService();
