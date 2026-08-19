/**
 * Firestore en memoria para las pruebas del POS.
 *
 * No es un doble "que devuelve lo que la prueba quiera": implementa la semántica que el
 * módulo POS necesita para que las pruebas de concurrencia sean significativas.
 *
 * - Consultas con `where` (`==`, `in`, `>=`, `<=`, `>`, `<`), `orderBy`, `limit` y
 *   `startAfter(snapshot)`.
 * - Transacciones con lecturas registradas: si un documento leído (o el resultado de una
 *   consulta leída) cambia antes del commit, la transacción aborta con `code: "aborted"` y
 *   se reintenta, igual que Firestore.
 * - `create` falla con `code: "already-exists"` y `update` con `code: "not-found"` en el
 *   commit, que es lo que usan los candados lógicos y la idempotencia del POS.
 * - Cada operación cede el turno del event loop, así que varias peticiones HTTP en paralelo
 *   se intercalan de verdad y las pruebas de contención no son secuenciales disfrazadas.
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";

type DocData = Record<string, unknown>;

interface StoredDoc {
  data: DocData;
  rev: number;
}

type FilterOperator = "==" | "!=" | ">=" | "<=" | ">" | "<" | "in" | "array-contains";

interface QueryFilter {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

interface QueryOrder {
  field: string;
  direction: "asc" | "desc";
}

interface QueryDescriptor {
  collectionPath: string;
  filters: readonly QueryFilter[];
  orders: readonly QueryOrder[];
  limit: number | null;
  startAfterId: string | null;
}

type WriteOperation =
  | { kind: "create"; path: string; data: DocData }
  | { kind: "set"; path: string; data: DocData; merge: boolean }
  | { kind: "update"; path: string; data: DocData }
  | { kind: "delete"; path: string };

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

export class FakeFirestoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FakeFirestoreError";
    this.code = code;
  }
}

const abortedError = (): FakeFirestoreError =>
  new FakeFirestoreError(
    "aborted",
    "Transaction aborted: too much contention on these documents.",
  );

const clone = <T>(value: T): T => {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Timestamp || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => clone(entry)) as unknown as T;
  }
  const output: DocData = {};
  for (const [key, entry] of Object.entries(value as DocData)) {
    output[key] = clone(entry);
  }
  return output as T;
};

const DELETE_MARKER = Symbol("fake-firestore-delete");

/**
 * Resuelve los sentinels de `FieldValue` que usan los servicios del ecommerce
 * (`serverTimestamp`, `increment`, `arrayUnion`, `delete`).
 */
const materialize = (value: unknown, existing: unknown): unknown => {
  if (!(value instanceof FieldValue)) {
    return clone(value);
  }
  const kind = value.constructor.name;
  if (kind.includes("ServerTimestamp")) {
    return Timestamp.now();
  }
  if (kind.includes("NumericIncrement")) {
    const operand = Number(
      (value as unknown as { operand?: unknown }).operand ?? 0,
    );
    const base = typeof existing === "number" ? existing : 0;
    return base + (Number.isFinite(operand) ? operand : 0);
  }
  if (kind.includes("ArrayUnion")) {
    const elements = ((value as unknown as { elements?: unknown[] }).elements ??
      []) as unknown[];
    const current = Array.isArray(existing) ? [...existing] : [];
    for (const element of elements) {
      if (!current.some((entry) => valuesEqual(entry, element))) {
        current.push(clone(element));
      }
    }
    return current;
  }
  if (kind.includes("ArrayRemove")) {
    const elements = ((value as unknown as { elements?: unknown[] }).elements ??
      []) as unknown[];
    const current = Array.isArray(existing) ? [...existing] : [];
    return current.filter(
      (entry) => !elements.some((element) => valuesEqual(entry, element)),
    );
  }
  if (kind.includes("Delete")) {
    return DELETE_MARKER;
  }
  return null;
};

const readField = (data: DocData, path: string): unknown => {
  if (!path.includes(".")) {
    return data[path];
  }
  let current: unknown = data;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as DocData)[segment];
  }
  return current;
};

const writeField = (data: DocData, path: string, value: unknown): void => {
  if (!path.includes(".")) {
    data[path] = value;
    return;
  }
  const segments = path.split(".");
  let current: DocData = data;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as DocData;
  }
  current[segments[segments.length - 1]] = value;
};

const comparable = (value: unknown): number | string | boolean | null => {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return value as number | string | boolean;
};

const valuesEqual = (left: unknown, right: unknown): boolean =>
  comparable(left) === comparable(right);

const compareValues = (left: unknown, right: unknown): number => {
  const a = comparable(left);
  const b = comparable(right);
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
};

const matchesFilter = (data: DocData, filter: QueryFilter): boolean => {
  const actual = readField(data, filter.field);
  switch (filter.operator) {
    case "==":
      return valuesEqual(actual, filter.value);
    case "!=":
      return !valuesEqual(actual, filter.value);
    case ">=":
      return actual !== undefined && compareValues(actual, filter.value) >= 0;
    case "<=":
      return actual !== undefined && compareValues(actual, filter.value) <= 0;
    case ">":
      return actual !== undefined && compareValues(actual, filter.value) > 0;
    case "<":
      return actual !== undefined && compareValues(actual, filter.value) < 0;
    case "in":
      return (
        Array.isArray(filter.value) &&
        filter.value.some((entry) => valuesEqual(actual, entry))
      );
    case "array-contains":
      return (
        Array.isArray(actual) &&
        actual.some((entry) => valuesEqual(entry, filter.value))
      );
    default:
      return false;
  }
};

export class FakeDocumentSnapshot {
  constructor(
    readonly ref: FakeDocumentReference,
    private readonly stored: StoredDoc | undefined,
  ) {}

  get id(): string {
    return this.ref.id;
  }

  get exists(): boolean {
    return this.stored !== undefined;
  }

  /** Revisión interna: la usa la transacción para detectar escrituras concurrentes. */
  get revision(): number {
    return this.stored?.rev ?? 0;
  }

  data(): DocData | undefined {
    return this.stored ? clone(this.stored.data) : undefined;
  }

  get(field: string): unknown {
    return this.stored ? clone(readField(this.stored.data, field)) : undefined;
  }
}

export class FakeQuerySnapshot {
  constructor(readonly docs: readonly FakeDocumentSnapshot[]) {}

  get empty(): boolean {
    return this.docs.length === 0;
  }

  get size(): number {
    return this.docs.length;
  }

  forEach(callback: (doc: FakeDocumentSnapshot) => void): void {
    this.docs.forEach((doc) => callback(doc));
  }
}

export class FakeQuery {
  constructor(
    readonly firestore: FakeFirestore,
    protected readonly collectionPath: string,
    protected readonly filters: readonly QueryFilter[] = [],
    protected readonly orders: readonly QueryOrder[] = [],
    protected readonly limitValue: number | null = null,
    protected readonly startAfterId: string | null = null,
  ) {}

  toDescriptor(): QueryDescriptor {
    return {
      collectionPath: this.collectionPath,
      filters: this.filters,
      orders: this.orders,
      limit: this.limitValue,
      startAfterId: this.startAfterId,
    };
  }

  where(field: string, operator: FilterOperator, value: unknown): FakeQuery {
    return new FakeQuery(
      this.firestore,
      this.collectionPath,
      [...this.filters, { field, operator, value }],
      this.orders,
      this.limitValue,
      this.startAfterId,
    );
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc"): FakeQuery {
    return new FakeQuery(
      this.firestore,
      this.collectionPath,
      this.filters,
      [...this.orders, { field, direction }],
      this.limitValue,
      this.startAfterId,
    );
  }

  limit(value: number): FakeQuery {
    return new FakeQuery(
      this.firestore,
      this.collectionPath,
      this.filters,
      this.orders,
      value,
      this.startAfterId,
    );
  }

  startAfter(cursor: FakeDocumentSnapshot | string): FakeQuery {
    const id = typeof cursor === "string" ? cursor : cursor.id;
    return new FakeQuery(
      this.firestore,
      this.collectionPath,
      this.filters,
      this.orders,
      this.limitValue,
      id,
    );
  }

  async get(): Promise<FakeQuerySnapshot> {
    await tick();
    return this.firestore.runQuery(this.toDescriptor());
  }
}

export class FakeCollectionReference extends FakeQuery {
  constructor(firestore: FakeFirestore, collectionPath: string) {
    super(firestore, collectionPath);
  }

  get id(): string {
    return this.collectionPath.split("/").pop() ?? this.collectionPath;
  }

  get path(): string {
    return this.collectionPath;
  }

  doc(id?: string): FakeDocumentReference {
    const docId = id ?? this.firestore.nextAutoId();
    return new FakeDocumentReference(
      this.firestore,
      `${this.collectionPath}/${docId}`,
      docId,
    );
  }
}

export class FakeDocumentReference {
  constructor(
    readonly firestore: FakeFirestore,
    readonly path: string,
    readonly id: string,
  ) {}

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this.firestore, `${this.path}/${name}`);
  }

  async get(): Promise<FakeDocumentSnapshot> {
    await tick();
    return this.firestore.snapshotOf(this);
  }

  async set(data: DocData, options?: { merge?: boolean }): Promise<void> {
    await tick();
    this.firestore.applyWrite({
      kind: "set",
      path: this.path,
      data,
      merge: options?.merge === true,
    });
  }

  async create(data: DocData): Promise<void> {
    await tick();
    this.firestore.assertCreatable(this.path);
    this.firestore.applyWrite({ kind: "create", path: this.path, data });
  }

  async update(data: DocData): Promise<void> {
    await tick();
    this.firestore.assertExists(this.path);
    this.firestore.applyWrite({ kind: "update", path: this.path, data });
  }

  async delete(): Promise<void> {
    await tick();
    this.firestore.applyWrite({ kind: "delete", path: this.path });
  }
}

class FakeTransaction {
  readonly documentReads = new Map<string, number>();
  readonly queryReads: Array<{ descriptor: QueryDescriptor; signature: string }> = [];
  readonly writes: WriteOperation[] = [];

  constructor(private readonly firestore: FakeFirestore) {}

  async get(
    target: FakeDocumentReference | FakeQuery,
  ): Promise<FakeDocumentSnapshot | FakeQuerySnapshot> {
    await tick();
    if (target instanceof FakeDocumentReference) {
      const snapshot = this.firestore.snapshotOf(target);
      this.documentReads.set(target.path, snapshot.revision);
      return snapshot;
    }
    const descriptor = target.toDescriptor();
    const snapshot = this.firestore.runQuery(descriptor);
    this.queryReads.push({
      descriptor,
      signature: this.firestore.querySignature(descriptor),
    });
    return snapshot;
  }

  async getAll(
    ...refs: FakeDocumentReference[]
  ): Promise<FakeDocumentSnapshot[]> {
    await tick();
    return refs.map((ref) => {
      const snapshot = this.firestore.snapshotOf(ref);
      this.documentReads.set(ref.path, snapshot.revision);
      return snapshot;
    });
  }

  create(ref: FakeDocumentReference, data: DocData): FakeTransaction {
    this.writes.push({ kind: "create", path: ref.path, data: clone(data) });
    return this;
  }

  set(
    ref: FakeDocumentReference,
    data: DocData,
    options?: { merge?: boolean },
  ): FakeTransaction {
    this.writes.push({
      kind: "set",
      path: ref.path,
      data: clone(data),
      merge: options?.merge === true,
    });
    return this;
  }

  update(ref: FakeDocumentReference, data: DocData): FakeTransaction {
    this.writes.push({ kind: "update", path: ref.path, data: clone(data) });
    return this;
  }

  delete(ref: FakeDocumentReference): FakeTransaction {
    this.writes.push({ kind: "delete", path: ref.path });
    return this;
  }
}

export interface FakeFirestoreStats {
  commits: number;
  retries: number;
  conflicts: number;
}

export class FakeFirestore {
  private readonly documents = new Map<string, StoredDoc>();
  private autoId = 0;
  private stats: FakeFirestoreStats = { commits: 0, retries: 0, conflicts: 0 };

  // ---------------------------------------------------------------- API pública

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this, name);
  }

  doc(path: string): FakeDocumentReference {
    const id = path.split("/").pop() ?? path;
    return new FakeDocumentReference(this, path, id);
  }

  async getAll(
    ...refs: FakeDocumentReference[]
  ): Promise<FakeDocumentSnapshot[]> {
    await tick();
    return refs.map((ref) => this.snapshotOf(ref));
  }

  settings(): void {
    // El cliente real acepta settings una sola vez; aquí no hay nada que configurar.
  }

  async runTransaction<T>(
    handler: (transaction: FirebaseFirestore.Transaction) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown = abortedError();
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const transaction = new FakeTransaction(this);
      try {
        const result = await handler(
          transaction as unknown as FirebaseFirestore.Transaction,
        );
        await tick();
        this.commit(transaction);
        this.stats.commits += 1;
        return result;
      } catch (error) {
        if (!(error instanceof FakeFirestoreError) || error.code !== "aborted") {
          throw error;
        }
        lastError = error;
        this.stats.retries += 1;
        await tick();
      }
    }
    throw lastError;
  }

  // -------------------------------------------------------------- utilidades test

  reset(): void {
    this.documents.clear();
    this.autoId = 0;
    this.stats = { commits: 0, retries: 0, conflicts: 0 };
  }

  statsSnapshot(): FakeFirestoreStats {
    return { ...this.stats };
  }

  /** Inserta un documento sin pasar por validaciones: solo para preparar escenarios. */
  seed(collectionPath: string, id: string, data: DocData): void {
    this.documents.set(`${collectionPath}/${id}`, {
      data: clone(data),
      rev: 1,
    });
  }

  /** Retira un documento sembrado, sin pasar por la capa transaccional. */
  remove(collectionPath: string, id: string): void {
    this.documents.delete(`${collectionPath}/${id}`);
  }

  read(collectionPath: string, id: string): DocData | undefined {
    const stored = this.documents.get(`${collectionPath}/${id}`);
    return stored ? clone(stored.data) : undefined;
  }

  /** Todos los documentos de una colección con su `id`, sin filtros ni orden. */
  listAll(collectionPath: string): Array<DocData & { id: string }> {
    const prefix = `${collectionPath}/`;
    const output: Array<DocData & { id: string }> = [];
    for (const [path, stored] of this.documents) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.includes("/")) continue;
      output.push({ id: rest, ...clone(stored.data) });
    }
    return output;
  }

  nextAutoId(): string {
    this.autoId += 1;
    return `auto${String(this.autoId).padStart(6, "0")}`;
  }

  // ------------------------------------------------------------------- internos

  snapshotOf(ref: FakeDocumentReference): FakeDocumentSnapshot {
    return new FakeDocumentSnapshot(ref, this.documents.get(ref.path));
  }

  assertCreatable(path: string): void {
    if (this.documents.has(path)) {
      throw new FakeFirestoreError(
        "already-exists",
        `Document already exists: ${path}`,
      );
    }
  }

  assertExists(path: string): void {
    if (!this.documents.has(path)) {
      throw new FakeFirestoreError("not-found", `No document to update: ${path}`);
    }
  }

  applyWrite(operation: WriteOperation): void {
    const existing = this.documents.get(operation.path);
    switch (operation.kind) {
      case "create": {
        this.documents.set(operation.path, {
          data: this.mergeFields({}, operation.data),
          rev: 1,
        });
        return;
      }
      case "set": {
        if (operation.merge && existing) {
          this.documents.set(operation.path, {
            data: this.mergeFields(clone(existing.data), operation.data),
            rev: existing.rev + 1,
          });
          return;
        }
        this.documents.set(operation.path, {
          data: this.mergeFields({}, operation.data),
          rev: (existing?.rev ?? 0) + 1,
        });
        return;
      }
      case "update": {
        if (!existing) {
          throw new FakeFirestoreError(
            "not-found",
            `No document to update: ${operation.path}`,
          );
        }
        this.documents.set(operation.path, {
          data: this.mergeFields(clone(existing.data), operation.data),
          rev: existing.rev + 1,
        });
        return;
      }
      case "delete": {
        this.documents.delete(operation.path);
        return;
      }
    }
  }

  private mergeFields(target: DocData, patch: DocData): DocData {
    for (const [field, value] of Object.entries(patch)) {
      // El cliente real se inicializa con `ignoreUndefinedProperties`.
      if (value === undefined) {
        continue;
      }
      const resolved = materialize(value, readField(target, field));
      if (resolved === DELETE_MARKER) {
        delete target[field];
        continue;
      }
      writeField(target, field, resolved);
    }
    return target;
  }

  runQuery(descriptor: QueryDescriptor): FakeQuerySnapshot {
    return new FakeQuerySnapshot(this.matchingDocs(descriptor));
  }

  querySignature(descriptor: QueryDescriptor): string {
    return this.matchingDocs(descriptor)
      .map((doc) => `${doc.id}:${doc.revision}`)
      .join("|");
  }

  private matchingDocs(descriptor: QueryDescriptor): FakeDocumentSnapshot[] {
    const prefix = `${descriptor.collectionPath}/`;
    const rows: Array<{ id: string; stored: StoredDoc }> = [];
    for (const [path, stored] of this.documents) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.includes("/")) continue;
      rows.push({ id: rest, stored });
    }

    let filtered = rows.filter((row) =>
      descriptor.filters.every((filter) => matchesFilter(row.stored.data, filter)),
    );

    for (const order of descriptor.orders) {
      // Firestore excluye los documentos sin el campo de ordenación.
      filtered = filtered.filter(
        (row) => readField(row.stored.data, order.field) !== undefined,
      );
    }

    const orders = descriptor.orders;
    filtered.sort((left, right) => {
      for (const order of orders) {
        const result = compareValues(
          readField(left.stored.data, order.field),
          readField(right.stored.data, order.field),
        );
        if (result !== 0) {
          return order.direction === "desc" ? -result : result;
        }
      }
      // Empate resuelto por nombre de documento, como hace Firestore.
      const byId = left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      const lastDirection = orders[orders.length - 1]?.direction ?? "asc";
      return lastDirection === "desc" ? -byId : byId;
    });

    if (descriptor.startAfterId) {
      const index = filtered.findIndex((row) => row.id === descriptor.startAfterId);
      if (index >= 0) {
        filtered = filtered.slice(index + 1);
      }
    }

    if (descriptor.limit !== null) {
      filtered = filtered.slice(0, descriptor.limit);
    }

    return filtered.map(
      (row) =>
        new FakeDocumentSnapshot(
          new FakeDocumentReference(
            this,
            `${descriptor.collectionPath}/${row.id}`,
            row.id,
          ),
          row.stored,
        ),
    );
  }

  private commit(transaction: FakeTransaction): void {
    for (const [path, revision] of transaction.documentReads) {
      if ((this.documents.get(path)?.rev ?? 0) !== revision) {
        this.stats.conflicts += 1;
        throw abortedError();
      }
    }
    for (const queryRead of transaction.queryReads) {
      if (this.querySignature(queryRead.descriptor) !== queryRead.signature) {
        this.stats.conflicts += 1;
        throw abortedError();
      }
    }

    // Firestore evalúa las precondiciones de cada mutación en orden dentro del commit: un
    // `update` sobre un documento creado en la misma transacción es válido. La validación se
    // hace completa antes de aplicar nada para que el commit siga siendo atómico.
    const touched = new Map<string, boolean>();
    const existsNow = (path: string): boolean =>
      touched.has(path) ? Boolean(touched.get(path)) : this.documents.has(path);

    for (const operation of transaction.writes) {
      switch (operation.kind) {
        case "create": {
          if (existsNow(operation.path)) {
            throw new FakeFirestoreError(
              "already-exists",
              `Document already exists: ${operation.path}`,
            );
          }
          touched.set(operation.path, true);
          break;
        }
        case "update": {
          if (!existsNow(operation.path)) {
            throw new FakeFirestoreError(
              "not-found",
              `No document to update: ${operation.path}`,
            );
          }
          break;
        }
        case "set": {
          touched.set(operation.path, true);
          break;
        }
        case "delete": {
          touched.set(operation.path, false);
          break;
        }
      }
    }

    for (const operation of transaction.writes) {
      this.applyWrite(operation);
    }
  }
}
