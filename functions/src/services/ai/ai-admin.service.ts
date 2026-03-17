import { firestoreTienda } from "../../config/firebase";
import AI_COLLECTIONS from "./collections";

class AiAdminService {
  async getMetrics() {
    const [sessions, messages, toolCalls, jobs] = await Promise.all([
      firestoreTienda.collection(AI_COLLECTIONS.sessions).count().get(),
      firestoreTienda.collection(AI_COLLECTIONS.messages).count().get(),
      firestoreTienda.collection(AI_COLLECTIONS.toolCalls).count().get(),
      firestoreTienda.collection(AI_COLLECTIONS.tryOnJobs).count().get(),
    ]);

    return {
      sessions: sessions.data().count,
      messages: messages.data().count,
      toolCalls: toolCalls.data().count,
      tryOnJobs: jobs.data().count,
    };
  }

  async listRecentJobs() {
    const snapshot = await firestoreTienda
      .collection(AI_COLLECTIONS.tryOnJobs)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }
}

export const aiAdminService = new AiAdminService();
export default aiAdminService;
