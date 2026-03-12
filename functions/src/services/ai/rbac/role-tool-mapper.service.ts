import { RolUsuario } from "../../../models/usuario.model";

export type AiCapability = "customer" | "support" | "inventory" | "admin";

class RoleToolMapperService {
  getCapabilities(role: RolUsuario, scopes: string[] = []): AiCapability[] {
    if (role === RolUsuario.ADMIN) {
      return ["admin", "support", "inventory", "customer"];
    }

    if (role === RolUsuario.CLIENTE) {
      return ["customer"];
    }

    const normalizedScopes = scopes.map((scope) => scope.toLowerCase());
    const capabilities: AiCapability[] = ["support", "customer"];
    if (normalizedScopes.includes("inventory")) {
      capabilities.push("inventory");
    }

    return capabilities;
  }
}

export const roleToolMapperService = new RoleToolMapperService();
export default roleToolMapperService;
