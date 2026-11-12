import { assertLocalFirestoreTarget } from "../src/config/local-firestore-guard";

const prodApp = { app: "APP_OFICIAL", projectId: "app-oficial-leon" };
const prodTienda = { app: "TIENDA_APP", projectId: "e-comerce-leon" };

describe("protección de Firestore en el servidor local", () => {
  beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it("no afecta Cloud Functions (producción)", () => {
    expect(assertLocalFirestoreTarget(prodApp, { IS_LOCAL: "true", K_SERVICE: "api" })).toBe("not-local");
    expect(assertLocalFirestoreTarget(prodTienda, { FUNCTION_NAME: "api" })).toBe("not-local");
  });

  it("no afecta pruebas, CI ni scripts sin IS_LOCAL=true", () => {
    expect(assertLocalFirestoreTarget(prodApp, {})).toBe("not-local");
    expect(assertLocalFirestoreTarget(prodTienda, { IS_LOCAL: "false" })).toBe("not-local");
  });

  it("permite el servidor local con el emulador", () => {
    const env = { IS_LOCAL: "true", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" };
    expect(assertLocalFirestoreTarget(prodApp, env)).toBe("emulator");
    expect(assertLocalFirestoreTarget(prodTienda, env)).toBe("emulator");
  });

  it("bloquea el servidor local sin emulador contra producción", () => {
    expect(() => assertLocalFirestoreTarget(prodApp, { IS_LOCAL: "true" })).toThrow(/FIRESTORE_EMULATOR_HOST/);
    expect(() => assertLocalFirestoreTarget(prodTienda, { IS_LOCAL: "true", FIRESTORE_EMULATOR_HOST: "  " })).toThrow(/producción/);
  });

  it("la opción explícita no sirve para proyectos de producción", () => {
    const env = { IS_LOCAL: "true", ALLOW_LOCAL_REAL_FIRESTORE: "true" };
    expect(() => assertLocalFirestoreTarget(prodApp, env)).toThrow(/app-oficial-leon/);
    expect(() => assertLocalFirestoreTarget(prodTienda, env)).toThrow(/e-comerce-leon/);
  });

  it("permite un proyecto independiente no productivo solo con opción explícita", () => {
    const staging = { app: "APP_OFICIAL", projectId: "club-leon-staging" };
    expect(() => assertLocalFirestoreTarget(staging, { IS_LOCAL: "true" })).toThrow();
    expect(
      assertLocalFirestoreTarget(staging, { IS_LOCAL: "true", ALLOW_LOCAL_REAL_FIRESTORE: "true" }),
    ).toBe("allowed-non-production");
  });
});
