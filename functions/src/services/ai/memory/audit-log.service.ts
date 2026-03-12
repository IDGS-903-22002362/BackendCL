import { admin } from "../../../config/firebase.admin";
import { firestoreTienda } from "../../../config/firebase";
import { AiAuditLog } from "../../../models/ai/ai.model";
import AI_COLLECTIONS from "../collections";

class AiAuditLogService {
  async write(entry: Omit<AiAuditLog, "id" | "createdAt">): Promise<void> {
    await firestoreTienda.collection(AI_COLLECTIONS.auditLogs).add({
      ...entry,
      createdAt: admin.firestore.Timestamp.now(),
    });
  }
}

export const aiAuditLogService = new AiAuditLogService();
export default aiAuditLogService;
