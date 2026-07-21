import { RolUsuario, UsuarioApp } from "../models/usuario.model";

type UsuarioRolesInput = Pick<UsuarioApp, "rol" | "roles"> | {
  rol?: RolUsuario | string;
  roles?: (RolUsuario | string)[];
};

export const ROL_TRABAJADOR_CLUBLEON = RolUsuario.TRABAJADOR_CLUBLEON;

const FORBIDDEN_TRABAJADOR_CLUB_ROLES: RolUsuario[] = [
  RolUsuario.SUPER_ADMIN,
  RolUsuario.ADMIN,
  RolUsuario.EMPLEADO,
  RolUsuario.EMPLEADO_CLUB,
  RolUsuario.CONCESION_SUPERADMIN,
  RolUsuario.CONCESION_ADMIN,
  RolUsuario.CONCESION_VENDEDOR,
];

export const getEffectiveRoles = (usuario: UsuarioRolesInput): RolUsuario[] => {
  if (usuario.roles && usuario.roles.length > 0) {
    return usuario.roles as RolUsuario[];
  }
  if (usuario.rol) {
    return [usuario.rol as RolUsuario];
  }
  return [];
};

export const hasRole = (
  usuario: UsuarioRolesInput,
  role: RolUsuario | string,
): boolean => getEffectiveRoles(usuario).includes(role as RolUsuario);

export const isTrabajadorClub = (usuario: UsuarioRolesInput): boolean =>
  hasRole(usuario, ROL_TRABAJADOR_CLUBLEON);

/** Una cuenta compradora no puede conservar ningún rol interno adicional. */
export const isCustomerOnlyAccount = (usuario: UsuarioRolesInput): boolean => {
  const roles = getEffectiveRoles(usuario);
  return roles.length > 0 && roles.every((role) => role === RolUsuario.CLIENTE);
};

export const canAddAsTrabajadorClub = (
  usuario: UsuarioRolesInput & { activo?: boolean },
): { ok: true } | { ok: false; code: string; message: string } => {
  if (usuario.activo === false) {
    return {
      ok: false,
      code: "INACTIVE_USER",
      message: "La cuenta del usuario está inactiva",
    };
  }

  const roles = getEffectiveRoles(usuario);

  if (isTrabajadorClub(usuario)) {
    return {
      ok: false,
      code: "ALREADY_TRABAJADOR",
      message: "El usuario ya es trabajador del club",
    };
  }

  if (roles.some((r) => FORBIDDEN_TRABAJADOR_CLUB_ROLES.includes(r))) {
    return {
      ok: false,
      code: "FORBIDDEN_ROLE",
      message: "Este usuario no puede agregarse como trabajador del club",
    };
  }

  if (!hasRole(usuario, RolUsuario.CLIENTE)) {
    return {
      ok: false,
      code: "NOT_CLIENTE",
      message: "Solo usuarios con rol CLIENTE pueden agregarse",
    };
  }

  return { ok: true };
};
