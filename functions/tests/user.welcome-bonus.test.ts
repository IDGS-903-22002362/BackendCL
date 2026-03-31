import { Timestamp } from "firebase-admin/firestore";
import { RolUsuario, TipoMovimientoPuntos } from "../src/models/usuario.model";

type DocData = Record<string, any>;
type QueryFilter = { field: string; op: string; value: unknown };

let fakeFirestore: ReturnType<typeof createFakeFirestore>;

const authCreateUser = jest.fn();
const fixedNow = Timestamp.fromDate(new Date("2026-03-30T12:00:00.000Z"));

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {
    collection: (name: string) => fakeFirestore.collection(name),
    runTransaction: (cb: any) => fakeFirestore.runTransaction(cb),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    auth: () => ({
      createUser: authCreateUser,
    }),
    firestore: {
      Timestamp: {
        now: () => fixedNow,
      },
    },
  },
}));

import pointsService from "../src/services/puntos.service";
import userAppService from "../src/services/user.service";

function createFakeFirestore(initial: Record<string, Record<string, DocData>>) {
  const collections = new Map<string, Map<string, DocData>>();

  Object.entries(initial).forEach(([name, docs]) => {
    collections.set(
      name,
      new Map(Object.entries(docs).map(([id, data]) => [id, { ...data }])),
    );
  });

  let idCounter = 0;

  const getCollection = (name: string): Map<string, DocData> => {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }

    return collections.get(name)!;
  };

  const createSnapshot = (collectionName: string, id: string) => {
    const data = getCollection(collectionName).get(id);

    return {
      exists: !!data,
      id,
      data: () => (data ? { ...data } : undefined),
      ref: docRefFactory(collectionName, id),
    };
  };

  const applyPatch = (current: DocData, patch: DocData): DocData => ({
    ...current,
    ...patch,
  });

  const docRefFactory = (collectionName: string, id: string) => ({
    id,
    async get() {
      return createSnapshot(collectionName, id);
    },
    set(data: DocData, options?: { merge?: boolean }) {
      const collection = getCollection(collectionName);
      const current = collection.get(id);

      if (options?.merge && current) {
        collection.set(id, applyPatch(current, data));
        return;
      }

      collection.set(id, { ...data });
    },
    update(patch: DocData) {
      const collection = getCollection(collectionName);
      const current = collection.get(id);

      if (!current) {
        throw new Error(`Doc ${collectionName}/${id} not found`);
      }

      collection.set(id, applyPatch(current, patch));
    },
    create(data: DocData) {
      const collection = getCollection(collectionName);

      if (collection.has(id)) {
        const error = new Error("already exists") as Error & { code?: string };
        error.code = "already-exists";
        throw error;
      }

      collection.set(id, { ...data });
    },
    collection(subcollectionName: string) {
      return collectionFactory(`${collectionName}/${id}/${subcollectionName}`);
    },
  });

  const queryFactory = (
    collectionName: string,
    filters: QueryFilter[] = [],
    limitCount?: number,
  ) => ({
    where(field: string, op: string, value: unknown) {
      return queryFactory(collectionName, [...filters, { field, op, value }], limitCount);
    },
    orderBy() {
      return queryFactory(collectionName, filters, limitCount);
    },
    limit(count: number) {
      return queryFactory(collectionName, filters, count);
    },
    async get() {
      let docs = Array.from(getCollection(collectionName).entries())
        .filter(([, data]) =>
          filters.every((filter) => {
            if (filter.op !== "==") {
              throw new Error(`Unsupported op ${filter.op}`);
            }

            return data[filter.field] === filter.value;
          }),
        )
        .map(([id]) => createSnapshot(collectionName, id));

      if (typeof limitCount === "number") {
        docs = docs.slice(0, limitCount);
      }

      return {
        empty: docs.length === 0,
        size: docs.length,
        docs,
      };
    },
  });

  const collectionFactory = (name: string) => ({
    doc(id?: string) {
      const docId = id ?? `auto_${++idCounter}`;
      return docRefFactory(name, docId);
    },
    where(field: string, op: string, value: unknown) {
      return queryFactory(name, [{ field, op, value }]);
    },
    orderBy() {
      return queryFactory(name);
    },
    async get() {
      return queryFactory(name).get();
    },
  });

  return {
    collection(name: string) {
      return collectionFactory(name);
    },
    async runTransaction(callback: any) {
      const transaction = {
        get: async (docRef: any) => docRef.get(),
        set: (docRef: any, data: DocData, options?: { merge?: boolean }) =>
          docRef.set(data, options),
        update: (docRef: any, patch: DocData) => docRef.update(patch),
      };

      return callback(transaction);
    },
    getCollectionData(name: string): Record<string, DocData> {
      return Object.fromEntries(getCollection(name).entries());
    },
  };
}

describe("welcome bonus on registration", () => {
  beforeEach(() => {
    authCreateUser.mockReset();
    fakeFirestore = createFakeFirestore({
      usuariosApp: {},
      configuracion: {},
    });
  });

  it("asigna 40 puntos al crear un usuario por email", async () => {
    authCreateUser.mockResolvedValue({ uid: "uid_email_1" });

    const usuario = await userAppService.createUser({
      nombre: "Usuario Nuevo",
      email: "nuevo@clubleon.com",
      password: "password-seguro",
      telefono: "4770000000",
      fechaNacimiento: new Date("2000-01-10T00:00:00.000Z"),
      edad: 26,
      genero: "M",
    });

    expect(usuario.uid).toBe("uid_email_1");
    expect(usuario.puntosActuales).toBe(40);
    expect(usuario.bonoBienvenidaOtorgadoAt?.toMillis()).toBe(fixedNow.toMillis());

    const usuarios = fakeFirestore.getCollectionData("usuariosApp");
    expect(usuarios.uid_email_1.puntosActuales).toBe(40);
    expect(usuarios.uid_email_1.bonoBienvenidaOtorgadoAt.toMillis()).toBe(
      fixedNow.toMillis(),
    );

    const movimientos = Object.values(
      fakeFirestore.getCollectionData("usuariosApp/uid_email_1/movimientos_puntos"),
    );

    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({
      tipo: TipoMovimientoPuntos.BONIFICACION,
      puntos: 40,
      origen: "promo",
      referencia: "registro",
    });
  });

  it("no duplica el bono de bienvenida si se intenta otorgar dos veces", async () => {
    fakeFirestore = createFakeFirestore({
      usuariosApp: {
        uid_social_1: {
          uid: "uid_social_1",
          provider: "google",
          nombre: "Usuario Social",
          email: "social@clubleon.com",
          rol: RolUsuario.CLIENTE,
          puntosActuales: 0,
          perfilCompleto: false,
          edad: 0,
          genero: "",
          activo: true,
          createdAt: fixedNow,
          updatedAt: fixedNow,
        },
      },
      configuracion: {},
    });

    const primerResultado = await pointsService.otorgarBonoBienvenida("uid_social_1");
    const segundoResultado = await pointsService.otorgarBonoBienvenida("uid_social_1");

    expect(primerResultado.puntosActuales).toBe(40);
    expect(segundoResultado.puntosActuales).toBe(40);

    const usuarios = fakeFirestore.getCollectionData("usuariosApp");
    expect(usuarios.uid_social_1.puntosActuales).toBe(40);

    const movimientos = Object.values(
      fakeFirestore.getCollectionData("usuariosApp/uid_social_1/movimientos_puntos"),
    );

    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({
      tipo: TipoMovimientoPuntos.BONIFICACION,
      puntos: 40,
    });
  });
});