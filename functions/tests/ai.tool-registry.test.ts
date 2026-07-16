import { RolUsuario } from "../src/models/usuario.model";
import toolRegistryService from "../src/services/ai/rbac/tool-registry.service";

describe("AI tool registry", () => {
  it("expone solo tools publicas al cliente", () => {
    const tools = toolRegistryService.getAllowedTools(RolUsuario.CLIENTE);
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("search_products");
    expect(names).toContain("create_tryon_job");
    expect(names).not.toContain("admin_update_stock");
    expect(names).not.toContain("admin_update_price");
  });

  it("no expone inventario interno a empleado sin scope", () => {
    const tools = toolRegistryService.getAllowedTools(RolUsuario.EMPLEADO, []);
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("search_products");
    expect(names).not.toContain("admin_update_stock");
    expect(names).not.toContain("admin_view_private_inventory");
  });

  it("expone inventario interno a empleado con scope inventory", () => {
    const tools = toolRegistryService.getAllowedTools(RolUsuario.EMPLEADO, ["inventory"]);
    const names = tools.map((tool) => tool.name);

    expect(names).not.toContain("admin_update_stock");
    expect(names).toContain("admin_view_private_inventory");
    expect(names).not.toContain("admin_update_price");
  });

  it("nunca expone mutaciones administrativas al modelo", () => {
    const tools = toolRegistryService.getAllowedTools(RolUsuario.ADMIN);
    const names = tools.map((tool) => tool.name);

    const deniedNames = [
      "admin_update_stock",
      "admin_update_price",
      "admin_publish_product",
      "admin_hide_product",
    ];

    expect(names).toContain("admin_view_private_inventory");
    for (const deniedName of deniedNames) {
      expect(names).not.toContain(deniedName);
      expect(toolRegistryService.getToolByName(deniedName)).toBeUndefined();
    }
  });
});
