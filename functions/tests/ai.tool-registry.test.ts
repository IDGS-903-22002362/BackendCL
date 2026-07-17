import { AiAgentType } from "../src/models/ai/ai.model";
import { RolUsuario } from "../src/models/usuario.model";
import toolRegistryService from "../src/services/ai/rbac/tool-registry.service";

const toolNames = (
  role: RolUsuario,
  agentType: AiAgentType,
  scopes: string[] = [],
): string[] =>
  toolRegistryService
    .getAllowedTools(role, scopes, { agentType })
    .map((tool) => tool.name);

describe("AI tool registry agent isolation", () => {
  it("Shopping Agent conserva tools comerciales y nunca recibe tools admin", () => {
    const names = toolNames(RolUsuario.ADMIN, AiAgentType.SHOPPING, [
      "inventory",
      "admin",
    ]);

    expect(names).toContain("search_products");
    expect(names).toContain("create_tryon_job");
    expect(names).not.toContain("admin_view_private_inventory");
    expect(names.some((name) => name.startsWith("admin_"))).toBe(false);
  });

  it("Admin Copilot recibe lectura administrativa pero no tools comerciales mutables", () => {
    const names = toolNames(RolUsuario.ADMIN, AiAgentType.ADMIN);

    expect(names).toContain("search_products");
    expect(names).toContain("admin_view_private_inventory");
    expect(names).not.toContain("create_cart");
    expect(names).not.toContain("add_to_cart");
    expect(names).not.toContain("create_tryon_job");
  });

  it("un rol no admin no obtiene toolset Admin Copilot aunque pida scopes", () => {
    const names = toolNames(RolUsuario.CLIENTE, AiAgentType.ADMIN, ["admin"]);
    expect(names).toEqual([]);
  });

  it("nunca expone mutaciones administrativas al modelo", () => {
    const names = toolNames(RolUsuario.ADMIN, AiAgentType.ADMIN);
    const deniedNames = [
      "admin_update_stock",
      "admin_update_price",
      "admin_publish_product",
      "admin_hide_product",
    ];

    for (const deniedName of deniedNames) {
      expect(names).not.toContain(deniedName);
      expect(
        toolRegistryService.getToolByName(deniedName, AiAgentType.ADMIN),
      ).toBeUndefined();
    }
  });
});
