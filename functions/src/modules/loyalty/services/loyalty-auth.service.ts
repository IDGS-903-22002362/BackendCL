import { RolUsuario } from "../../../models/usuario.model";
import {
  LoyaltyActorType,
  LoyaltyPermission,
} from "../models/loyalty.enums";
import { LoyaltyActorContext } from "../models/loyalty.types";

const ALL_PERMISSIONS = Object.values(LoyaltyPermission);

const ROLE_PERMISSIONS: Record<RolUsuario, LoyaltyPermission[]> = {
  [RolUsuario.CLIENTE]: [
    LoyaltyPermission.WALLET_READ_SELF,
    LoyaltyPermission.TRANSACTIONS_READ_SELF,
    LoyaltyPermission.POINTS_REDEEM,
  ],
  [RolUsuario.EMPLEADO]: [
    LoyaltyPermission.WALLET_READ_SELF,
    LoyaltyPermission.TRANSACTIONS_READ_SELF,
    LoyaltyPermission.POINTS_EARN,
    LoyaltyPermission.POINTS_REDEEM,
    LoyaltyPermission.TRANSACTIONS_READ_ANY,
  ],
  [RolUsuario.EMPLEADO_CLUB]: [
    LoyaltyPermission.WALLET_READ_SELF,
    LoyaltyPermission.TRANSACTIONS_READ_SELF,
    LoyaltyPermission.POINTS_EARN,
  ],
  [RolUsuario.TRABAJADOR_CLUBLEON]: [
    LoyaltyPermission.WALLET_READ_SELF,
    LoyaltyPermission.TRANSACTIONS_READ_SELF,
    LoyaltyPermission.POINTS_REDEEM,
  ],
  [RolUsuario.CONCESION_VENDEDOR]: [
    LoyaltyPermission.WALLET_READ_SELF,
    LoyaltyPermission.TRANSACTIONS_READ_SELF,
    LoyaltyPermission.POINTS_EARN,
    LoyaltyPermission.POINTS_REDEEM,
    LoyaltyPermission.TRANSACTIONS_READ_ANY,
  ],
  [RolUsuario.ADMIN]: ALL_PERMISSIONS,
  [RolUsuario.SUPER_ADMIN]: ALL_PERMISSIONS,
  // Roles del POS de concesiones: sin permisos de loyalty de tienda.
  [RolUsuario.CONCESION_SUPERADMIN]: [],
  [RolUsuario.CONCESION_ADMIN]: [],
};

export function mapRolToActorType(rol: RolUsuario): LoyaltyActorType {
  switch (rol) {
    case RolUsuario.ADMIN:
      return LoyaltyActorType.ADMIN;
    case RolUsuario.SUPER_ADMIN:
      return LoyaltyActorType.SUPER_ADMIN;
    case RolUsuario.EMPLEADO:
    case RolUsuario.EMPLEADO_CLUB:
    case RolUsuario.CONCESION_VENDEDOR:
      return LoyaltyActorType.EMPLOYEE;
    default:
      return LoyaltyActorType.USER;
  }
}

export function permissionsForRole(rol: RolUsuario): LoyaltyPermission[] {
  return ROLE_PERMISSIONS[rol] ?? ROLE_PERMISSIONS[RolUsuario.CLIENTE];
}

export function buildActorContext(input: {
  uid: string;
  rol: RolUsuario;
}): LoyaltyActorContext {
  const permissions = permissionsForRole(input.rol);
  return {
    actorType: mapRolToActorType(input.rol),
    actorId: input.uid,
    roles: [input.rol],
    permissions: permissions.map(String),
  };
}

export function actorHasPermission(
  actor: LoyaltyActorContext,
  permission: LoyaltyPermission,
): boolean {
  return actor.permissions.includes(permission);
}
