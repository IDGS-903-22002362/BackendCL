import {
  AiAgentType,
  resolveAiAgentType,
} from "../src/models/ai/ai.model";
import {
  getAiPlannerInstructions,
  getAiResponderInstructions,
} from "../src/services/ai/ai.prompts";
import { requireAiAdmin } from "../src/middleware/ai-authz.middleware";
import { RolUsuario } from "../src/models/usuario.model";

describe("AI agent type compatibility and prompts", () => {
  it("trata sesiones legacy o valores desconocidos como Shopping Agent", () => {
    expect(resolveAiAgentType(undefined)).toBe(AiAgentType.SHOPPING);
    expect(resolveAiAgentType("legacy")).toBe(AiAgentType.SHOPPING);
    expect(resolveAiAgentType(AiAgentType.ADMIN)).toBe(AiAgentType.ADMIN);
  });

  it("mantiene prompts separados y Admin Copilot en modo solo lectura", () => {
    const shoppingPlanner = getAiPlannerInstructions(AiAgentType.SHOPPING);
    const adminPlanner = getAiPlannerInstructions(AiAgentType.ADMIN);
    const adminResponder = getAiResponderInstructions(AiAgentType.ADMIN);

    expect(shoppingPlanner).not.toBe(adminPlanner);
    expect(shoppingPlanner).toContain("Shopping Agent");
    expect(adminPlanner).toContain("Admin Copilot");
    expect(adminPlanner).toContain("solo lectura");
    expect(adminResponder).toContain("propuesta no ejecutada");
  });

  it("rechaza acceso Admin Copilot para un usuario autenticado no-admin", () => {
    const req = {
      user: { uid: "customer-1", rol: RolUsuario.CLIENTE },
    } as never;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as never;
    const next = jest.fn();

    requireAiAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as { status: jest.Mock }).status).toHaveBeenCalledWith(403);
    expect((res as { json: jest.Mock }).json).toHaveBeenCalledWith({
      success: false,
      message: "Acceso restringido a administradores",
    });
  });
});
