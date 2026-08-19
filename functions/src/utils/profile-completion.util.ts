export const PUNTOS_BONO_PERFIL = 15;
export const PUNTOS_BONO_SOCIAL_REGISTRO = 15;

export type ProfileDemographicInput = {
  nombre?: unknown;
  telefono?: unknown;
  fechaNacimiento?: unknown;
  genero?: unknown;
};

export type NormalizedProfileDemographics = {
  nombre?: string;
  telefono: string;
  fechaNacimiento: string;
  genero: string;
};

export function normalizeGenero(genero?: string): string | undefined {
  if (!genero) return undefined;

  const key = genero.trim().toLowerCase();
  const generoMap: Record<string, string> = {
    m: "masculino",
    f: "femenino",
    o: "otro",
    masculino: "masculino",
    femenino: "femenino",
    otro: "otro",
  };

  return generoMap[key] || genero.trim();
}

export function normalizeTelefono(telefono?: string): string {
  return String(telefono ?? "").replace(/\D/g, "");
}

export function hasDemographicFieldsComplete(input: {
  telefono?: string | null;
  fechaNacimiento?: string | Date | null;
  genero?: string | null;
}): boolean {
  const telefono = normalizeTelefono(input.telefono ?? undefined);
  const genero = normalizeGenero(input.genero ?? undefined) ?? "";
  const fecha =
    input.fechaNacimiento instanceof Date
      ? input.fechaNacimiento.toISOString().slice(0, 10)
      : String(input.fechaNacimiento ?? "").trim().slice(0, 10);

  return telefono.length === 10 && fecha.length >= 8 && genero.length > 0;
}

export function canClaimProfileBonus(user: {
  provider?: string | null;
  bonoPerfilCompletadoAt?: unknown;
  telefono?: string | null;
  fechaNacimiento?: string | Date | null;
  genero?: string | null;
}): boolean {
  if (user.provider !== "email") return false;
  if (user.bonoPerfilCompletadoAt) return false;
  return !hasDemographicFieldsComplete(user);
}

export function shouldAwardSocialSignupBonus(user: {
  provider?: string | null;
  bonoSocialRegistroAt?: unknown;
}): boolean {
  return (
    (user.provider === "google" || user.provider === "apple") &&
    !user.bonoSocialRegistroAt
  );
}

export function validateRequiredDemographics(
  body: ProfileDemographicInput,
  options: { requireNombre?: boolean } = {},
):
  | { ok: true; data: NormalizedProfileDemographics }
  | { ok: false; message: string } {
  const requireNombre = options.requireNombre ?? false;
  const nombre =
    typeof body.nombre === "string" ? body.nombre.trim() : undefined;
  const telefono = normalizeTelefono(
    typeof body.telefono === "string" ? body.telefono : undefined,
  );
  const fechaRaw =
    typeof body.fechaNacimiento === "string"
      ? body.fechaNacimiento.trim()
      : body.fechaNacimiento instanceof Date
        ? body.fechaNacimiento.toISOString().slice(0, 10)
        : "";
  const fechaNacimiento = fechaRaw.slice(0, 10);
  const genero = normalizeGenero(
    typeof body.genero === "string" ? body.genero : undefined,
  );

  if (requireNombre && (!nombre || nombre.length < 2)) {
    return { ok: false, message: "El nombre es requerido" };
  }

  if (telefono.length !== 10) {
    return {
      ok: false,
      message: "El telefono debe tener exactamente 10 digitos",
    };
  }

  if (!fechaNacimiento || Number.isNaN(Date.parse(fechaNacimiento))) {
    return { ok: false, message: "La fecha de nacimiento es requerida" };
  }

  if (!genero) {
    return { ok: false, message: "El genero es requerido" };
  }

  return {
    ok: true,
    data: {
      ...(nombre ? { nombre } : {}),
      telefono,
      fechaNacimiento,
      genero,
    },
  };
}
