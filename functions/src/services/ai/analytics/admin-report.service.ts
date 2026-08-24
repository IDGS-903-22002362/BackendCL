/**
 * Sesiones y trazabilidad del Asistente Administrativo.
 *
 * Guarda el minimo necesario para permitir preguntas de seguimiento
 * ("¿y contra el mes pasado?") y para auditar de donde salio cada dato:
 * herramientas usadas, periodo consultado, duracion y exito por consulta.
 *
 * No persiste datos sensibles ni prompts completos del modelo.
 */

import { admin } from "../../../config/firebase.admin";
import { firestoreTienda } from "../../../config/firebase";
import { RolUsuario } from "../../../models/usuario.model";
import logger from "../../../utils/logger";
import AI_COLLECTIONS from "../collections";
import { AI_INTERNAL_ERROR_CODE, AiRuntimeError } from "../ai.error";
import adminReportAgent, {
  AdminAgentEvent,
  AdminAgentHistoryEntry,
  AdminReportResult,
} from "./admin-report.agent";

const MAX_HISTORY_TURNS = 4;
const MAX_SESSIONS_LISTED = 30;
const MAX_TURNS_RETURNED = 20;

export interface AdminAssistantSession {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: number;
}

export interface AdminAssistantTurn {
  id: string;
  sessionId: string;
  question: string;
  summary: string;
  report: unknown;
  trace: unknown;
  success: boolean;
  createdAt: string;
}

export interface AskAdminAssistantInput {
  sessionId: string;
  userId: string;
  role: RolUsuario;
  question: string;
  requestId?: string;
}

const toIso = (value: unknown): string => {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  return new Date().toISOString();
};

const buildTitle = (question: string): string => {
  const normalized = question.trim().replace(/\s+/g, " ");
  return normalized.length > 60
    ? `${normalized.slice(0, 57)}...`
    : normalized || "Nueva consulta";
};

class AdminAssistantService {
  private readonly baseLogger = logger.child({
    component: "admin-assistant-service",
  });

  private get sessions() {
    return firestoreTienda.collection(AI_COLLECTIONS.adminAssistantSessions);
  }

  private get turns() {
    return firestoreTienda.collection(AI_COLLECTIONS.adminAssistantTurns);
  }

  async createSession(input: {
    userId: string;
    title?: string;
  }): Promise<AdminAssistantSession> {
    const now = admin.firestore.Timestamp.now();
    const payload = {
      userId: input.userId,
      title: input.title?.trim() || "Nuevo analisis",
      turns: 0,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await this.sessions.add(payload);

    return {
      id: ref.id,
      userId: payload.userId,
      title: payload.title,
      turns: 0,
      createdAt: toIso(now),
      updatedAt: toIso(now),
    };
  }

  async listSessions(userId: string): Promise<AdminAssistantSession[]> {
    const snapshot = await this.sessions
      .where("userId", "==", userId)
      .orderBy("updatedAt", "desc")
      .limit(MAX_SESSIONS_LISTED)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        userId: String(data.userId || ""),
        title: String(data.title || "Analisis"),
        turns: Number(data.turns || 0),
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt),
      };
    });
  }

  /**
   * Devuelve la sesion solo si pertenece al usuario autenticado.
   * El acceso por rol ya se valida en el middleware; esto agrega ownership.
   */
  async getOwnedSession(
    sessionId: string,
    userId: string,
  ): Promise<AdminAssistantSession | null> {
    const snapshot = await this.sessions.doc(sessionId).get();
    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() as Record<string, unknown>;
    if (data.userId !== userId) {
      return null;
    }

    return {
      id: snapshot.id,
      userId: String(data.userId || ""),
      title: String(data.title || "Analisis"),
      turns: Number(data.turns || 0),
      createdAt: toIso(data.createdAt),
      updatedAt: toIso(data.updatedAt),
    };
  }

  /**
   * Turnos de una sesion en orden cronologico. Se usa el mismo orden
   * ascendente en todas las lecturas para depender de un solo indice
   * (`sessionId` + `createdAt`).
   */
  async listTurns(sessionId: string): Promise<AdminAssistantTurn[]> {
    const snapshot = await this.turns
      .where("sessionId", "==", sessionId)
      .orderBy("createdAt", "asc")
      .limit(MAX_TURNS_RETURNED)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        sessionId: String(data.sessionId || ""),
        question: String(data.question || ""),
        summary: String(data.summary || ""),
        report: data.report ?? null,
        trace: data.trace ?? null,
        success: data.success !== false,
        createdAt: toIso(data.createdAt),
      };
    });
  }

  private async buildHistory(
    sessionId: string,
  ): Promise<AdminAgentHistoryEntry[]> {
    const turns = await this.listTurns(sessionId);
    const entries: AdminAgentHistoryEntry[] = [];

    for (const turn of turns.slice(-MAX_HISTORY_TURNS)) {
      const question = turn.question.trim();
      const summary = turn.summary.trim();

      if (question) {
        entries.push({ role: "user", content: question });
      }
      if (summary) {
        entries.push({ role: "assistant", content: summary });
      }
    }

    return entries;
  }

  private async persistTurn(input: {
    sessionId: string;
    userId: string;
    question: string;
    result: AdminReportResult;
  }): Promise<void> {
    const now = admin.firestore.Timestamp.now();

    try {
      await this.turns.add({
        sessionId: input.sessionId,
        userId: input.userId,
        question: input.question,
        summary: input.result.report.summary,
        report: input.result.report,
        trace: input.result.trace,
        success: true,
        createdAt: now,
      });

      const sessionRef = this.sessions.doc(input.sessionId);
      const sessionSnapshot = await sessionRef.get();
      const isFirstTurn =
        Number((sessionSnapshot.data() as Record<string, unknown> | undefined)?.turns || 0) === 0;

      await sessionRef.update({
        updatedAt: now,
        turns: admin.firestore.FieldValue.increment(1),
        // El titulo se toma de la primera pregunta y luego no se sobreescribe.
        ...(isFirstTurn ? { title: buildTitle(input.question) } : {}),
      });
    } catch (error) {
      // La persistencia de trazabilidad no debe romper la respuesta al usuario.
      this.baseLogger.warn("admin_assistant_turn_persist_failed", {
        sessionId: input.sessionId,
        errorMessage:
          error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }

  /** Ejecuta el agente emitiendo eventos (SSE) y persiste la traza al final. */
  async *askStream(
    input: AskAdminAssistantInput,
  ): AsyncGenerator<AdminAgentEvent> {
    const history = await this.buildHistory(input.sessionId);

    for await (const event of adminReportAgent.run({
      question: input.question,
      userId: input.userId,
      role: input.role,
      requestId: input.requestId,
      sessionId: input.sessionId,
      history,
    })) {
      if (event.type === "final") {
        await this.persistTurn({
          sessionId: input.sessionId,
          userId: input.userId,
          question: input.question,
          result: event.data,
        });
      }

      yield event;
    }
  }

  /** Version JSON (sin streaming). */
  async ask(input: AskAdminAssistantInput): Promise<AdminReportResult> {
    let result: AdminReportResult | undefined;

    for await (const event of this.askStream(input)) {
      if (event.type === "final") {
        result = event.data;
      }
    }

    if (!result) {
      throw new AiRuntimeError(
        AI_INTERNAL_ERROR_CODE,
        "El asistente administrativo no devolvio un informe",
        502,
      );
    }

    return result;
  }
}

export const adminAssistantService = new AdminAssistantService();
export default adminAssistantService;
