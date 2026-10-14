import { describe, expect, it } from "@jest/globals";
import { guardarMinijuegoSchema } from "../src/middleware/validators/minijuego.validator";

function payload(premio: Record<string, unknown>) {
  return {
    beneficio: {
      titulo: "Cartas",
      descripcion: "Premio especial",
      estatus: true,
    },
    minijuego: {
      tipo: "cartas",
      intentosPorUsuario: 1,
      audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
    },
    premios: [
      {
        nombre: "Boletos",
        tipo: "physical",
        stock: 1,
        especial: true,
        ...premio,
      },
    ],
  };
}

describe("guardar minijuego premio especial", () => {
  it("acepta un premio especial sin términos ni vigencia", () => {
    const parsed = guardarMinijuegoSchema.parse(payload({}));
    expect(parsed.premios[0]?.terminos).toBeUndefined();
    expect(parsed.premios[0]?.caducaEl).toBeUndefined();
  });

  it("rechaza una caducidad anterior a la validez", () => {
    const result = guardarMinijuegoSchema.safeParse(
      payload({
        terminos: "Canje en taquilla.",
        validoDesde: "2026-06-01T00:00:00.000Z",
        caducaEl: "2026-05-01T00:00:00.000Z",
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path.includes("caducaEl"))).toBe(
      true,
    );
  });
});
