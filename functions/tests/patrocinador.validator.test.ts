import {
  createPatrocinadorSchema,
  updatePatrocinadorSchema,
} from "../src/middleware/validators/patrocinador.validator";

describe("patrocinador url", () => {
  const base = { nombre: "Corona", estatus: true, exclusivo: true };

  it("acepta un enlace https opcional", () => {
    const parsed = createPatrocinadorSchema.parse({
      ...base,
      url: "https://corona.mx/promo",
    });

    expect(parsed.url).toBe("https://corona.mx/promo");
  });

  it("acepta dejar el enlace vacío", () => {
    const parsed = updatePatrocinadorSchema.parse({ url: "  " });

    expect(parsed.url).toBe("");
  });

  it("rechaza un esquema que no es http", () => {
    const result = createPatrocinadorSchema.safeParse({
      ...base,
      url: "javascript:alert(1)",
    });

    expect(result.success).toBe(false);
  });
});
