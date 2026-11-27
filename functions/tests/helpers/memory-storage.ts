/**
 * Doble en memoria de un bucket de Cloud Storage para las pruebas.
 *
 * Solo implementa lo que usan las cartas y storageApp.service: save (con la
 * precondición ifGenerationMatch: 0), exists, delete y getMetadata.
 */

export type StoredObject = {
  path: string;
  data: Buffer;
  options: Record<string, unknown>;
};

class StorageApiError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "StorageApiError";
    this.code = code;
  }
}

function createMemoryBucket(name: string) {
  const objects = new Map<string, StoredObject>();
  const deleted: string[] = [];
  let failExists = false;

  function file(path: string) {
    return {
      name: path,
      async save(data: Buffer, options: Record<string, unknown> = {}) {
        const precondition = options.preconditionOpts as
          | { ifGenerationMatch?: number }
          | undefined;
        if (precondition?.ifGenerationMatch === 0 && objects.has(path)) {
          throw new StorageApiError(412, "Precondition Failed");
        }
        objects.set(path, { path, data: Buffer.from(data), options });
      },
      async exists(): Promise<[boolean]> {
        if (failExists) throw new StorageApiError(503, "Storage no disponible");
        return [objects.has(path)];
      },
      async delete() {
        if (!objects.has(path)) throw new StorageApiError(404, "No such object");
        objects.delete(path);
        deleted.push(path);
      },
      async getMetadata() {
        const stored = objects.get(path);
        if (!stored) throw new StorageApiError(404, "No such object");
        return [stored.options.metadata ?? {}];
      },
    };
  }

  return {
    name,
    file,
    objects,
    deleted,
    reset() {
      objects.clear();
      deleted.length = 0;
      failExists = false;
    },
    /** Simula un error de red al comprobar si un objeto existe. */
    setFailExists(value: boolean) {
      failExists = value;
    },
    /** Crea un objeto como si se hubiera subido antes. */
    put(path: string, data: Buffer = Buffer.from("webp")) {
      objects.set(path, { path, data, options: {} });
    },
  };
}

export const MEMORY_BUCKET_NAME = "app-oficial-leon.firebasestorage.app";

const STORE_KEY = Symbol.for("club-leon-memory-storage");
type MemoryBucket = ReturnType<typeof createMemoryBucket>;

const globalStore = globalThis as typeof globalThis & {
  [STORE_KEY]?: MemoryBucket;
};

export const memoryBucket =
  globalStore[STORE_KEY] ??
  (globalStore[STORE_KEY] = createMemoryBucket(MEMORY_BUCKET_NAME));

/** Sustituto de storageAppOficial (admin.storage()) para jest.mock. */
export const memoryStorage = {
  bucket: () => memoryBucket,
};
