import { readFileSync } from "fs";
import { resolve } from "path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestContext,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

const PROJECT_ID = "demo-backendcl-ai-rules";
const RULES_PATH = resolve(__dirname, "../../firestore.rules");

const AI_COLLECTIONS = [
  "ai_sessions",
  "ai_messages",
  "ai_tool_calls",
  "ai_audit_logs",
  "tryon_jobs",
  "tryon_assets",
  "ai_admin_proposals",
  "ai_admin_operations",
  "ai_metrics",
  "ai_evals",
  "ai_traces",
] as const;

const LIGA_MX_PUBLIC_COLLECTIONS = [
  "liga_mx_contexto_actual",
  "liga_mx_calendarios_actuales",
  "liga_mx_clasificaciones_actuales",
  "liga_mx_plantillas_actuales",
  "liga_mx_jugadores_actuales",
  "liga_mx_partidos_actuales",
  "liga_mx_detalles_partido_actuales",
] as const;

const CLIENT_KINDS = ["unauthenticated", "user", "admin"] as const;
type ClientKind = (typeof CLIENT_KINDS)[number];
type TestFirestore = ReturnType<RulesTestContext["firestore"]>;

let testEnvironment: RulesTestEnvironment;

function parseEmulatorAddress(): {host: string; port: number} {
  const address = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const separator = address.lastIndexOf(":");

  if (separator <= 0) {
    throw new Error(`Invalid FIRESTORE_EMULATOR_HOST: ${address}`);
  }

  return {
    host: address.slice(0, separator),
    port: Number(address.slice(separator + 1)),
  };
}

function getClientContext(kind: ClientKind): RulesTestContext {
  if (kind === "unauthenticated") {
    return testEnvironment.unauthenticatedContext();
  }

  if (kind === "admin") {
    return testEnvironment.authenticatedContext("admin-rules-test", {
      admin: true,
      rol: "SUPER_ADMIN",
    });
  }

  return testEnvironment.authenticatedContext("user-rules-test", {
    rol: "CLIENTE",
  });
}

function getClientFirestore(kind: ClientKind): TestFirestore {
  return getClientContext(kind).firestore();
}

beforeAll(async () => {
  const emulator = parseEmulatorAddress();

  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: emulator.host,
      port: emulator.port,
      rules: readFileSync(RULES_PATH, "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();

  // Admin bypass is used only to seed public fixtures. Every authorization
  // assertion below uses an unauthenticated or authenticated client context.
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();

    await Promise.all(
      LIGA_MX_PUBLIC_COLLECTIONS.map((collectionName) =>
        firestore.doc(`${collectionName}/public-fixture`).set({
          source: "rules-test",
        }),
      ),
    );
  });
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe("explicit AI Firestore rules", () => {
  it("declares every AI collection as recursively backend-only", () => {
    const rules = readFileSync(RULES_PATH, "utf8");

    for (const collectionName of AI_COLLECTIONS) {
      expect(rules).toContain(`match /${collectionName}/{document=**}`);
    }
  });

  describe.each(AI_COLLECTIONS)("%s", (collectionName) => {
    it.each(CLIENT_KINDS)(
      "denies root and descendant reads/writes for %s clients",
      async (clientKind) => {
        const firestore = getClientFirestore(clientKind);
        const rootDocument = firestore.doc(
          `${collectionName}/private-document`,
        );
        const descendantDocument = firestore.doc(
          `${collectionName}/private-document/` +
            "private-subcollection/private-child",
        );

        await assertFails(rootDocument.get());
        await assertFails(
          rootDocument.set({attemptedBy: clientKind, scope: "root"}),
        );
        await assertFails(descendantDocument.get());
        await assertFails(
          descendantDocument.set({
            attemptedBy: clientKind,
            scope: "descendant",
          }),
        );
      },
    );
  });
});

describe.each(LIGA_MX_PUBLIC_COLLECTIONS)(
  "Liga MX public rule for %s",
  (collectionName) => {
    it("allows unauthenticated document and collection reads", async () => {
      const firestore = getClientFirestore("unauthenticated");

      await assertSucceeds(
        firestore.doc(`${collectionName}/public-fixture`).get(),
      );
      await assertSucceeds(firestore.collection(collectionName).get());
    });

    it.each(CLIENT_KINDS)("denies writes for %s clients", async (clientKind) => {
      const firestore = getClientFirestore(clientKind);

      await assertFails(
        firestore.doc(`${collectionName}/attempted-write`).set({
          attemptedBy: clientKind,
        }),
      );
    });
  },
);
