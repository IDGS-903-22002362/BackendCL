/**
 * Sesiones del Asistente Administrativo.
 *
 * Las lecturas de turnos deben usar siempre el mismo orden ascendente:
 * una consulta descendente exigia un indice compuesto distinto y rompia
 * el stream antes de la primera llamada al agente.
 */

type DocData = Record<string, unknown>;

interface RecordedQuery {
  collection: string;
  where?: [string, string, unknown];
  orderBy?: [string, string];
  limit?: number;
}

let turnDocs: { id: string; data: DocData }[];
let sessionDocs: Record<string, DocData>;
let recordedQueries: RecordedQuery[];
let addedTurns: DocData[];
let sessionUpdates: DocData[];

const TURNS_COLLECTION = "ai_admin_assistant_turns";

const buildQuery = (collection: string, state: RecordedQuery) => ({
  where: (field: string, op: string, value: unknown) =>
    buildQuery(collection, { ...state, where: [field, op, value] }),
  orderBy: (field: string, direction = "asc") =>
    buildQuery(collection, { ...state, orderBy: [field, direction] }),
  limit: (value: number) => buildQuery(collection, { ...state, limit: value }),
  async get() {
    recordedQueries.push({ ...state, collection });

    if (collection !== TURNS_COLLECTION) {
      return { docs: [] };
    }

    // El mock respeta el orden de insercion: emula el `orderBy` ascendente.
    const docs = turnDocs.filter(
      (doc) => !state.where || doc.data[state.where[0]] === state.where[2],
    );

    return {
      docs: docs.map((doc) => ({ id: doc.id, data: () => doc.data })),
    };
  },
});

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => ({
      ...buildQuery(name, { collection: name }),
      add: async (payload: DocData) => {
        if (name === TURNS_COLLECTION) {
          addedTurns.push(payload);
        }
        return { id: `${name}-doc` };
      },
      doc: (id: string) => ({
        async get() {
          const data = sessionDocs[id];
          return { exists: Boolean(data), id, data: () => data };
        },
        async update(payload: DocData) {
          sessionUpdates.push(payload);
        },
      }),
    }),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: { now: () => ({ toDate: () => new Date("2026-08-20T18:00:00.000Z") }) },
      FieldValue: { increment: (value: number) => ({ increment: value }) },
    },
  },
}));

jest.mock("../src/services/ai/analytics/admin-report.agent", () => ({
  __esModule: true,
  default: { run: jest.fn() },
}));

import adminAssistantService from "../src/services/ai/analytics/admin-report.service";
import adminReportAgent from "../src/services/ai/analytics/admin-report.agent";
import { RolUsuario } from "../src/models/usuario.model";

const agentRun = adminReportAgent.run as jest.Mock;

const turn = (index: number) => ({
  id: `turn-${index}`,
  data: {
    sessionId: "session-1",
    question: `pregunta ${index}`,
    summary: `resumen ${index}`,
    createdAt: { toDate: () => new Date(`2026-08-2${index}T10:00:00.000Z`) },
  },
});

const buildResult = () => ({
  report: {
    summary: "Resumen del informe",
    confidence: "alta" as const,
    blocks: [
      { type: "text" as const, kind: "conclusion" as const, content: "Todo bien" },
    ],
  },
  trace: {
    toolsUsed: ["get_sales_summary"],
    toolCalls: [],
    investigationRounds: 1,
    reachedToolLimit: false,
    model: "modelo-test",
    purpose: "main",
    durationMs: 10,
    timeZone: "America/Mexico_City",
  },
});

const drain = async (sessionId: string, question: string) => {
  const events = [];
  for await (const event of adminAssistantService.askStream({
    sessionId,
    userId: "admin-1",
    role: RolUsuario.ADMIN,
    question,
  })) {
    events.push(event);
  }
  return events;
};

describe("adminAssistantService", () => {
  beforeEach(() => {
    turnDocs = [];
    sessionDocs = { "session-1": { userId: "admin-1", title: "Analisis", turns: 0 } };
    recordedQueries = [];
    addedTurns = [];
    sessionUpdates = [];
    agentRun.mockReset();
    agentRun.mockImplementation(async function* () {
      yield { type: "final", data: buildResult() };
    });
  });

  it("lee los turnos en orden ascendente para no depender de otro indice", async () => {
    turnDocs = [turn(1), turn(2)];

    await adminAssistantService.listTurns("session-1");
    await drain("session-1", "nueva pregunta");

    const turnQueries = recordedQueries.filter(
      (query) => query.collection === TURNS_COLLECTION,
    );

    expect(turnQueries.length).toBeGreaterThan(0);
    for (const query of turnQueries) {
      expect(query.where).toEqual(["sessionId", "==", "session-1"]);
      expect(query.orderBy).toEqual(["createdAt", "asc"]);
    }
  });

  it("envia al agente los ultimos turnos en orden cronologico", async () => {
    turnDocs = [turn(1), turn(2), turn(3), turn(4), turn(5)];

    await drain("session-1", "y contra el mes pasado?");

    const history = agentRun.mock.calls[0][0].history;

    expect(history).toHaveLength(8);
    expect(history[0]).toEqual({ role: "user", content: "pregunta 2" });
    expect(history.at(-1)).toEqual({ role: "assistant", content: "resumen 5" });
  });

  it("guarda el turno con su traza y actualiza la sesion", async () => {
    await drain("session-1", "como vamos este mes?");

    expect(addedTurns).toHaveLength(1);
    expect(addedTurns[0]).toMatchObject({
      sessionId: "session-1",
      question: "como vamos este mes?",
      summary: "Resumen del informe",
      success: true,
    });
    expect(sessionUpdates[0]).toMatchObject({
      title: "como vamos este mes?",
      turns: { increment: 1 },
    });
  });

  it("no sobreescribe el titulo en preguntas de seguimiento", async () => {
    sessionDocs["session-1"] = {
      userId: "admin-1",
      title: "Primera pregunta",
      turns: 2,
    };

    await drain("session-1", "y contra el mes pasado?");

    expect(sessionUpdates[0]).not.toHaveProperty("title");
  });

  it("no devuelve sesiones de otro usuario", async () => {
    sessionDocs["session-1"] = { userId: "otro-admin", title: "Analisis", turns: 0 };

    await expect(
      adminAssistantService.getOwnedSession("session-1", "admin-1"),
    ).resolves.toBeNull();
  });
});
