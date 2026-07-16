import { RolUsuario } from "../../../models/usuario.model";
import { RuntimeAiToolDefinition } from "../tools/types";
import aiToolDefinitions from "../tools/definitions";
import roleToolMapperService from "./role-tool-mapper.service";

const MODEL_DENIED_TOOL_NAMES = new Set([
  "admin_update_stock",
  "admin_update_price",
  "admin_publish_product",
  "admin_hide_product",
]);

class ToolRegistryService {
  getAllowedTools(
    role: RolUsuario,
    scopes: string[] = [],
    options: { publicOnly?: boolean } = {},
  ): RuntimeAiToolDefinition[] {
    const capabilities = roleToolMapperService.getCapabilities(role, scopes);

    return aiToolDefinitions.filter((tool) => {
      if (MODEL_DENIED_TOOL_NAMES.has(tool.name)) {
        return false;
      }

      if (!tool.roles.includes(role)) {
        return false;
      }

       if (options.publicOnly && tool.public === false) {
        return false;
      }

      if (!tool.capabilities || tool.capabilities.length === 0) {
        return true;
      }

      return tool.capabilities.some((capability) => capabilities.includes(capability as never));
    });
  }

  getToolByName(name: string): RuntimeAiToolDefinition | undefined {
    if (MODEL_DENIED_TOOL_NAMES.has(name)) {
      return undefined;
    }

    return aiToolDefinitions.find((tool) => tool.name === name);
  }
}

export const toolRegistryService = new ToolRegistryService();
export default toolRegistryService;
