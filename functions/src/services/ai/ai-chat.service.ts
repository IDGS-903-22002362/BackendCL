import { RolUsuario } from "../../models/usuario.model";
import aiSessionService from "./memory/session.service";
import aiMessageService from "./memory/message.service";
import aiToolCallService from "./memory/tool-call.service";
import aiOrchestrator from "./adapters/ai-orchestrator";

class AiChatService {
  async createSession(input: { userId: string; role: RolUsuario; channel: string; title?: string }) {
    return aiSessionService.createSession(input);
  }

  async listSessions(userId: string) {
    return aiSessionService.listSessionsByUser(userId);
  }

  async getSessionDetail(sessionId: string) {
    const [session, messages, toolCalls] = await Promise.all([
      aiSessionService.getSessionById(sessionId),
      aiMessageService.listMessagesBySession(sessionId),
      aiToolCallService.listToolCallsBySession(sessionId),
    ]);

    return {
      session,
      messages,
      toolCalls,
    };
  }

  async sendMessage(input: {
    sessionId: string;
    userId: string;
    role: RolUsuario;
    message: string;
    aiToolScopes?: string[];
    requestId?: string;
  }) {
    return aiOrchestrator.handleMessage(input);
  }
}

export const aiChatService = new AiChatService();
export default aiChatService;
