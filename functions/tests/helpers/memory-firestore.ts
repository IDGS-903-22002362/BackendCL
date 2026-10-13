import { Timestamp } from "firebase-admin/firestore";

type DocData = Record<string, unknown>;

type StoredDoc = {
  data: DocData;
  version: number;
};

type WriteOp =
  | { op: "set"; path: string; data: DocData; merge: boolean }
  | { op: "update"; path: string; data: DocData }
  | { op: "create"; path: string; data: DocData };

type DocRef = {
  __kind: "doc";
  path: string;
  id: string;
  get: () => Promise<DocSnap>;
  set: (data: DocData, options?: { merge?: boolean }) => Promise<void>;
  update: (data: DocData) => Promise<void>;
  create: (data: DocData) => Promise<void>;
  collection: (name: string) => CollectionRef;
};

type CollectionRef = {
  __kind: "collection";
  path: string;
  id: string;
  doc: (id?: string) => DocRef;
  get: () => Promise<QuerySnap>;
};

type DocSnap = {
  id: string;
  exists: boolean;
  ref: DocRef;
  data: () => DocData | undefined;
};

type QuerySnap = {
  empty: boolean;
  size: number;
  docs: DocSnap[];
};

class TransactionConflict extends Error {
  constructor() {
    super("transaction conflict");
    this.name = "TransactionConflict";
  }
}

function isTimestamp(value: object): boolean {
  return typeof (value as { toMillis?: unknown }).toMillis === "function";
}

function sanitize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date || isTimestamp(value)) return value;

  const method = (value as { _methodName?: unknown })._methodName;
  if (typeof method === "string" && method.includes("serverTimestamp")) {
    return Timestamp.now();
  }
  if (typeof method === "string" && method.includes("FieldValue")) {
    throw new Error(`FieldValue no soportado por el doble de pruebas: ${method}`);
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));

  const output: DocData = {};
  for (const [key, item] of Object.entries(value as DocData)) {
    if (item === undefined) continue;
    output[key] = sanitize(item);
  }
  return output;
}

function cloneData<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date || isTimestamp(value as object)) return value;
  if (Array.isArray(value)) return value.map((item) => cloneData(item)) as T;

  const output: DocData = {};
  for (const [key, item] of Object.entries(value as DocData)) {
    output[key] = cloneData(item);
  }
  return output as T;
}

function createMemoryFirestore() {
  const docs = new Map<string, StoredDoc>();
  const collectionVersions = new Map<string, number>();
  let sequence = 0;

  function autoId(): string {
    sequence += 1;
    return `auto${sequence.toString(16)}`;
  }

  function parentPath(path: string): string {
    return path.split("/").slice(0, -1).join("/");
  }

  function versionOf(path: string): number {
    return docs.get(path)?.version ?? 0;
  }

  function bumpCollection(path: string): void {
    const parent = parentPath(path);
    if (!parent) return;
    collectionVersions.set(parent, (collectionVersions.get(parent) ?? 0) + 1);
  }

  function childPaths(collectionPath: string): string[] {
    const prefix = `${collectionPath}/`;
    return [...docs.keys()]
      .filter((path) => {
        if (!path.startsWith(prefix)) return false;
        const rest = path.slice(prefix.length);
        return rest.length > 0 && !rest.includes("/");
      })
      .sort();
  }

  function writeDoc(path: string, data: DocData, merge: boolean): void {
    const current = docs.get(path);
    const next = merge && current ? { ...current.data, ...data } : data;
    docs.set(path, {
      data: next,
      version: (current?.version ?? 0) + 1,
    });
    bumpCollection(path);
  }

  function apply(write: WriteOp): void {
    if (write.op === "update") {
      if (!docs.has(write.path)) {
        throw new Error(`No existe el documento ${write.path}`);
      }
      writeDoc(write.path, write.data, true);
      return;
    }
    if (write.op === "create") {
      if (docs.has(write.path)) {
        throw new TransactionConflict();
      }
      writeDoc(write.path, write.data, false);
      return;
    }
    writeDoc(write.path, write.data, write.merge && docs.has(write.path));
  }

  function snapshot(path: string): DocSnap {
    const stored = docs.get(path);
    const data = stored ? cloneData(stored.data) : undefined;
    return {
      id: path.split("/").pop() ?? path,
      exists: Boolean(stored),
      ref: docApi(path),
      data: () => (data ? cloneData(data) : undefined),
    };
  }

  function query(collectionPath: string): QuerySnap {
    const found = childPaths(collectionPath).map((path) => snapshot(path));
    return {
      empty: found.length === 0,
      size: found.length,
      docs: found,
    };
  }

  function docApi(path: string): DocRef {
    return {
      __kind: "doc",
      path,
      id: path.split("/").pop() ?? path,
      get() {
        return Promise.resolve(snapshot(path));
      },
      set(data, options) {
        apply({
          op: "set",
          path,
          data: sanitize(data) as DocData,
          merge: Boolean(options?.merge),
        });
        return Promise.resolve();
      },
      update(data) {
        apply({ op: "update", path, data: sanitize(data) as DocData });
        return Promise.resolve();
      },
      create(data) {
        apply({ op: "create", path, data: sanitize(data) as DocData });
        return Promise.resolve();
      },
      collection(name: string) {
        return collectionApi(`${path}/${name}`);
      },
    };
  }

  function collectionApi(path: string): CollectionRef {
    return {
      __kind: "collection",
      path,
      id: path.split("/").pop() ?? path,
      doc(id?: string) {
        return docApi(id ? `${path}/${id}` : `${path}/${autoId()}`);
      },
      get() {
        return Promise.resolve(query(path));
      },
    };
  }

  function createSession() {
    const docReads = new Map<string, number>();
    const collectionReads = new Map<string, number>();
    const writes: WriteOp[] = [];

    const tx = {
      async get(ref: DocRef | CollectionRef) {
        if (ref.__kind === "collection") {
          if (!collectionReads.has(ref.path)) {
            collectionReads.set(ref.path, collectionVersions.get(ref.path) ?? 0);
          }
          return query(ref.path);
        }
        if (!docReads.has(ref.path)) {
          docReads.set(ref.path, versionOf(ref.path));
        }
        return snapshot(ref.path);
      },
      set(ref: DocRef, data: DocData, options?: { merge?: boolean }) {
        writes.push({
          op: "set",
          path: ref.path,
          data: sanitize(data) as DocData,
          merge: Boolean(options?.merge),
        });
      },
      update(ref: DocRef, data: DocData) {
        writes.push({
          op: "update",
          path: ref.path,
          data: sanitize(data) as DocData,
        });
      },
      create(ref: DocRef, data: DocData) {
        writes.push({
          op: "create",
          path: ref.path,
          data: sanitize(data) as DocData,
        });
      },
    };

    return {
      tx,
      commit() {
        for (const [path, version] of docReads) {
          if (versionOf(path) !== version) throw new TransactionConflict();
        }
        for (const [path, version] of collectionReads) {
          if ((collectionVersions.get(path) ?? 0) !== version) {
            throw new TransactionConflict();
          }
        }
        for (const write of writes) {
          if (write.op === "create" && docs.has(write.path)) {
            throw new TransactionConflict();
          }
          if (write.op === "update" && !docs.has(write.path)) {
            throw new Error(`No existe el documento ${write.path}`);
          }
        }
        for (const write of writes) apply(write);
      },
    };
  }

  const api = {
    __memory: true as const,
    collection(name: string) {
      return collectionApi(name);
    },
    async runTransaction<T>(fn: (tx: ReturnType<typeof createSession>["tx"]) => Promise<T>): Promise<T> {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await Promise.resolve();
        const session = createSession();
        try {
          const result = await fn(session.tx);
          session.commit();
          return result;
        } catch (error) {
          if (error instanceof TransactionConflict) continue;
          throw error;
        }
      }
      throw new Error("MINIGAME_TEST_TX_RETRY_LIMIT");
    },
    async getAll(...refs: DocRef[]) {
      return Promise.all(refs.map((ref) => ref.get()));
    },
  };

  return {
    api,
    reset() {
      docs.clear();
      collectionVersions.clear();
      sequence = 0;
    },
    put(path: string, data: DocData) {
      apply({ op: "set", path, data: sanitize(data) as DocData, merge: false });
    },
    read(path: string): DocData | null {
      const stored = docs.get(path);
      return stored ? cloneData(stored.data) : null;
    },
    list(collectionPath: string): DocData[] {
      return childPaths(collectionPath).map((path) => ({
        ...cloneData(docs.get(path)?.data ?? {}),
        id: path.split("/").pop(),
      }));
    },
  };
}

const STORE_KEY = Symbol.for("club-leon-prize-memory-firestore");
type MemoryFirestore = ReturnType<typeof createMemoryFirestore>;

const globalStore = globalThis as typeof globalThis & {
  [STORE_KEY]?: MemoryFirestore;
};

export const memoryFirestore =
  globalStore[STORE_KEY] ?? (globalStore[STORE_KEY] = createMemoryFirestore());
