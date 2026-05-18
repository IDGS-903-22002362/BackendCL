import { normalizeMxStateForFedEx } from "../src/modules/shipping/fedex/fedex-address.helper";

describe("normalizeMxStateForFedEx", () => {
  it("should normalize Guanajuato variants to GT", () => {
    expect(normalizeMxStateForFedEx("Guanajuato")).toBe("GT");
    expect(normalizeMxStateForFedEx("GTO")).toBe("GT");
    expect(normalizeMxStateForFedEx("GUA")).toBe("GT");
    expect(normalizeMxStateForFedEx("GT")).toBe("GT");
    expect(normalizeMxStateForFedEx("   guanajuato   ")).toBe("GT");
  });

  it("should normalize variants with spaces correctly", () => {
    expect(normalizeMxStateForFedEx("Baja California Sur")).toBe("BS");
    expect(normalizeMxStateForFedEx("Ciudad de México")).toBe("DF");
    expect(normalizeMxStateForFedEx("Estado de Mexico")).toBe("EM");
    expect(normalizeMxStateForFedEx("San Luis Potosí")).toBe("SL");
    expect(normalizeMxStateForFedEx("Veracruz de Ignacio de la Llave")).toBe("VE");
  });

  it("should remove accents and normalize", () => {
    expect(normalizeMxStateForFedEx("Michoacán")).toBe("MI");
    expect(normalizeMxStateForFedEx("Querétaro")).toBe("QE");
    expect(normalizeMxStateForFedEx("Yucatán")).toBe("YU");
    expect(normalizeMxStateForFedEx("Nuevo León")).toBe("NL");
  });

  it("should handle inputs with underscores by replacing them with spaces", () => {
    expect(normalizeMxStateForFedEx("BAJA_CALIFORNIA")).toBe("BC");
    expect(normalizeMxStateForFedEx("BAJA_CALIFORNIA_SUR")).toBe("BS");
    expect(normalizeMxStateForFedEx("CIUDAD_DE_MEXICO")).toBe("DF");
    expect(normalizeMxStateForFedEx("SAN_LUIS_POTOSI")).toBe("SL");
  });

  it("should return the exact same value if no match is found, but trimmed and original case?", () => {
    // Wait, the function does this:
    // const normalized = value.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/_/g, " ");
    // return map[normalized] ?? value.trim();
    // It returns original value trimmed if no match is found.
    expect(normalizeMxStateForFedEx("Unknown State")).toBe("Unknown State");
  });

  it("should return undefined for falsy values", () => {
    expect(normalizeMxStateForFedEx("")).toBeUndefined();
    expect(normalizeMxStateForFedEx(null)).toBeUndefined();
    expect(normalizeMxStateForFedEx(undefined)).toBeUndefined();
  });
});
