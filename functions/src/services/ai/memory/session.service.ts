import { admin } from "../../../config/firebase.admin";
import { firestoreTienda } from "../../../config/firebase";
import { RolUsuario } from "../../../models/usuario.model";
import {
  AiSession,
  AiSessionMode,
  AiSessionStatus,
  ConversationState,
} from "../../../models/ai/ai.model";
import AI_COLLECTIONS from "../collections";

class AiSessionService {
  async createSession(input: {
    userId: string;
    role: RolUsuario;
    channel: string;
    title?: string;
    mode?: AiSessionMode;
    guestAccess?: AiSession["guestAccess"];
    conversationState?: ConversationState;
  }): Promise<AiSession> {
    const now = admin.firestore.Timestamp.now();
    const payload: Omit<AiSession, "id"> = {
      userId: input.userId,
      role: input.role,
      mode: input.mode || AiSessionMode.AUTHENTICATED,
      channel: input.channel,
      title: input.title?.trim() || "Nueva conversacion",
      status: AiSessionStatus.ACTIVE,
      summary: "",
      guestAccess: input.guestAccess || null,
      conversationState: input.conversationState || {},
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    };

    const ref = await firestoreTienda.collection(AI_COLLECTIONS.sessions).add(payload);
    return { id: ref.id, ...payload };
  }

  async getSessionById(id: string): Promise<AiSession | null> {
    const snapshot = await firestoreTienda.collection(AI_COLLECTIONS.sessions).doc(id).get();
    if (!snapshot.exists) {
      return null;
    }

    return { id: snapshot.id, ...(snapshot.data() as Omit<AiSession, "id">) };
  }

  async listSessionsByUser(userId: string): Promise<AiSession[]> {
    const snapshot = await firestoreTienda
      .collection(AI_COLLECTIONS.sessions)
      .where("userId", "==", userId)
      .orderBy("updatedAt", "desc")
      .limit(50)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<AiSession, "id">),
    }));
  }

  async updateSessionSummary(sessionId: string, summary: string): Promise<void> {
    await firestoreTienda.collection(AI_COLLECTIONS.sessions).doc(sessionId).update({
      summary,
      updatedAt: admin.firestore.Timestamp.now(),
    });
  }

  async updateConversationState(
    sessionId: string,
    conversationState: ConversationState,
  ): Promise<void> {
    await firestoreTienda
      .collection(AI_COLLECTIONS.sessions)
      .doc(sessionId)
      .update({
        conversationState,
        updatedAt: admin.firestore.Timestamp.now(),
      });
  }

  async touchGuestSession(sessionId: string): Promise<void> {
    const now = admin.firestore.Timestamp.now();
    await firestoreTienda.collection(AI_COLLECTIONS.sessions).doc(sessionId).update({
      "guestAccess.lastUsedAt": now,
      lastMessageAt: now,
      updatedAt: now,
    });
  }

  async touchSession(sessionId: string): Promise<void> {
    const now = admin.firestore.Timestamp.now();
    await firestoreTienda.collection(AI_COLLECTIONS.sessions).doc(sessionId).update({
      lastMessageAt: now,
      updatedAt: now,
    });
  }
}

export const aiSessionService = new AiSessionService();
export default aiSessionService;
