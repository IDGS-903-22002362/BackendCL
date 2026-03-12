import { admin } from "../../../config/firebase.admin";
import { firestoreTienda } from "../../../config/firebase";
import { AiAttachment, AiMessage, AiMessageRole, AiUsageMetrics } from "../../../models/ai/ai.model";
import AI_COLLECTIONS from "../collections";

class AiMessageService {
  async createMessage(input: {
    sessionId: string;
    userId: string;
    role: AiMessageRole;
    content: string;
    model?: string;
    attachments?: AiAttachment[];
    toolCallIds?: string[];
    latencyMs?: number;
    tokenUsage?: AiUsageMetrics;
  }): Promise<AiMessage> {
    const payload: Omit<AiMessage, "id"> = {
      sessionId: input.sessionId,
      userId: input.userId,
      role: input.role,
      content: input.content,
      model: input.model,
      attachments: input.attachments || [],
      toolCallIds: input.toolCallIds || [],
      latencyMs: input.latencyMs,
      tokenUsage: input.tokenUsage,
      createdAt: admin.firestore.Timestamp.now(),
    };

    const ref = await firestoreTienda.collection(AI_COLLECTIONS.messages).add(payload);
    return { id: ref.id, ...payload };
  }

  async listMessagesBySession(sessionId: string, limit = 30): Promise<AiMessage[]> {
    const snapshot = await firestoreTienda
      .collection(AI_COLLECTIONS.messages)
      .where("sessionId", "==", sessionId)
      .orderBy("createdAt", "asc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<AiMessage, "id">),
    }));
  }
}

export const aiMessageService = new AiMessageService();
export default aiMessageService;
