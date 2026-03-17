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

    expect(names).toContain("admin_update_stock");
    expect(names).toContain("admin_view_private_inventory");
    expect(names).not.toContain("admin_update_price");
  });

  it("expone todas las tools administrativas al admin", () => {
    const tools = toolRegistryService.getAllowedTools(RolUsuario.ADMIN);
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("admin_update_stock");
    expect(names).toContain("admin_update_price");
    expect(names).toContain("admin_publish_product");
    expect(names).toContain("admin_hide_product");
  });
});
