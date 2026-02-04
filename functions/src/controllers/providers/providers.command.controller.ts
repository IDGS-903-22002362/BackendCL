import { Request, Response } from "express";
import providerService from "../../services/provider.service";

/**
 * POST /api/proveedores
 * Crea un nuevo proveedor
 */
export const create = async (req: Request, res: Response) => {
  try {
    const proveedorData = req.body;

    // Validar campos requeridos
    const camposRequeridos = ["nombre"];
    const camposFaltantes = camposRequeridos.filter(
      (campo) => !proveedorData[campo],
    );

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Faltan campos requeridos",
        camposFaltantes,
      });
    }

    // Validar que el nombre no esté vacío
    if (proveedorData.nombre.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "El nombre del proveedor no puede estar vacío",
      });
    }

    // Crear proveedor
    const nuevoProveedor = await providerService.createProvider({
      nombre: proveedorData.nombre.trim(),
      contacto: proveedorData.contacto?.trim(),
      telefono: proveedorData.telefono?.trim(),
      email: proveedorData.email?.trim(),
      direccion: proveedorData.direccion?.trim(),
      activo: proveedorData.activo ?? true,
      notas: proveedorData.notas?.trim(),
    });

    return res.status(201).json({
      success: true,
      message: "Proveedor creado exitosamente",
      data: nuevoProveedor,
    });
  } catch (error) {
    console.error("Error en POST /api/proveedores:", error);

    // Manejar errores de unicidad
    if (error instanceof Error && error.message.includes("Ya existe")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error al crear el proveedor",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * PUT /api/proveedores/:id
 * Actualiza un proveedor existente
 */
export const update = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "El ID del proveedor es requerido",
      });
    }

    // Validar que el nombre no esté vacío si se proporciona
    if (updateData.nombre && updateData.nombre.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "El nombre del proveedor no puede estar vacío",
      });
    }

    // Preparar datos de actualización (sanear strings)
    const dataToUpdate: any = {};
    if (updateData.nombre) dataToUpdate.nombre = updateData.nombre.trim();
    if (updateData.contacto !== undefined)
      dataToUpdate.contacto = updateData.contacto?.trim();
    if (updateData.telefono !== undefined)
      dataToUpdate.telefono = updateData.telefono?.trim();
    if (updateData.email !== undefined)
      dataToUpdate.email = updateData.email?.trim();
    if (updateData.direccion !== undefined)
      dataToUpdate.direccion = updateData.direccion?.trim();
    if (updateData.activo !== undefined)
      dataToUpdate.activo = updateData.activo;
    if (updateData.notas !== undefined)
      dataToUpdate.notas = updateData.notas?.trim();

    // Actualizar proveedor
    const proveedorActualizado = await providerService.updateProvider(
      id,
      dataToUpdate,
    );

    return res.status(200).json({
      success: true,
      message: "Proveedor actualizado exitosamente",
      data: proveedorActualizado,
    });
  } catch (error) {
    console.error(`Error en PUT /api/proveedores/${req.params.id}:`, error);

    // Manejar errores de no encontrado o unicidad
    if (error instanceof Error) {
      if (error.message.includes("no encontrado")) {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }
      if (error.message.includes("Ya existe")) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }
    }

    return res.status(500).json({
      success: false,
      message: "Error al actualizar el proveedor",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * DELETE /api/proveedores/:id
 * Elimina un proveedor (soft delete)
 */
export const remove = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "El ID del proveedor es requerido",
      });
    }

    // Eliminar proveedor (soft delete)
    await providerService.deleteProvider(id);

    return res.status(200).json({
      success: true,
      message: "Proveedor eliminado exitosamente",
    });
  } catch (error) {
    console.error(`Error en DELETE /api/proveedores/${req.params.id}:`, error);

    // Manejar error de no encontrado
    if (error instanceof Error && error.message.includes("no encontrado")) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error al eliminar el proveedor",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
