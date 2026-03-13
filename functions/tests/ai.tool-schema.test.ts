import { z } from "zod";
import {
  buildFunctionDeclaration,
  buildToolParametersJsonSchema,
} from "../src/services/ai/tools/types";
import { RolUsuario } from "../src/models/usuario.model";

describe("AI tool schema builder", () => {
  it("genera parametersJsonSchema inline sin referencias top-level", () => {
    const schema = buildToolParametersJsonSchema(
      z
        .object({
          query: z.string().trim().min(1).max(120),
        })
        .strict(),
    );

    expect(schema).toMatchObject({
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
      },
      required: ["query"],
      additionalProperties: false,
    });
    expect(schema).not.toHaveProperty("$ref");
    expect(schema).not.toHaveProperty("$defs");
    expect(schema).not.toHaveProperty("definitions");
    expect(schema).not.toHaveProperty("$schema");
  });

  it("omite parametersJsonSchema para tools sin parametros", () => {
    const declaration = buildFunctionDeclaration({
      name: "get_shipping_info",
      description: "Obtiene politica de envio",
      schema: z.object({}).strict(),
      roles: [RolUsuario.CLIENTE],
      execute: jest.fn(),
    });

    expect(declaration).toEqual({
      name: "get_shipping_info",
      description: "Obtiene politica de envio",
    });
    expect(declaration).not.toHaveProperty("parametersJsonSchema");
  });
});
