import { admin } from "../../../config/firebase.admin";
import { firestoreTienda } from "../../../config/firebase";
import { AiToolCall, AiToolCallStatus } from "../../../models/ai/ai.model";
import AI_COLLECTIONS from "../collections";

class AiToolCallService {
  async createToolCall(input: {
    sessionId: string;
    messageId: string;
    userId: string;
    toolName: string;
    input: Record<string, unknown>;
    output?: Record<string, unknown>;
    status: AiToolCallStatus;
    durationMs?: number;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<AiToolCall> {
    const payload: Omit<AiToolCall, "id"> = {
      ...input,
      createdAt: admin.firestore.Timestamp.now(),
    };

    const ref = await firestoreTienda.collection(AI_COLLECTIONS.toolCalls).add(payload);
    return { id: ref.id, ...payload };
  }

  async listToolCallsBySession(sessionId: string): Promise<AiToolCall[]> {
    const snapshot = await firestoreTienda
      .collection(AI_COLLECTIONS.toolCalls)
      .where("sessionId", "==", sessionId)
      .orderBy("createdAt", "asc")
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<AiToolCall, "id">),
    }));
  }
}

export const aiToolCallService = new AiToolCallService();
export default aiToolCallService;
