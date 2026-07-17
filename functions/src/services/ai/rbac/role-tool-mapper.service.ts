import { RolUsuario } from "../../../models/usuario.model";
import { AiAgentType } from "../../../models/ai/ai.model";

export type AiCapability = "customer" | "support" | "inventory" | "admin";

class RoleToolMapperService {
  getCapabilities(
    role: RolUsuario,
    scopes: string[] = [],
    agentType: AiAgentType = AiAgentType.SHOPPING,
  ): AiCapability[] {
    if (agentType === AiAgentType.ADMIN) {
      if (role !== RolUsuario.ADMIN) {
        return [];
      }

      return ["admin", "support", "inventory", "customer"];
    }

    // Shopping sessions always run with customer capabilities. Neither a
    // privileged role nor client-provided scopes can elevate this toolset.
    void scopes;
    return ["customer"];
  }
}

export const roleToolMapperService = new RoleToolMapperService();
export default roleToolMapperService;
