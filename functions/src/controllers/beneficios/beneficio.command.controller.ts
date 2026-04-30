import { Request, Response } from "express";
import beneficioService from "../../services/beneficio.service";
import { mapFirebaseError } from "../../utils/firebase-error.util";

export const create = async (req: Request, res: Response) => {
  try {
    const beneficioData = req.body;
    const nuevoBeneficio = await beneficioService.createBeneficio(beneficioData);

    return res.status(201).json({
      success: true,
      message: "Beneficio creado exitosamente",
      data: nuevoBeneficio,
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para crear beneficios",
      notFoundMessage: "Recurso relacionado no encontrado",
      internalMessage: "Error al crear el beneficio",
    });

    console.error("Error en POST /api/beneficios:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

export const update = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const beneficioActualizado = await beneficioService.updateBeneficio(
      id,
      updateData,
    );

    return res.status(200).json({
      success: true,
      message: "Beneficio actualizado exitosamente",
      data: beneficioActualizado,
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para actualizar beneficios",
      notFoundMessage: "Beneficio no encontrado",
      internalMessage: "Error al actualizar el beneficio",
    });

    console.error("Error en PUT /api/beneficios/:id:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await beneficioService.deleteBeneficio(id);

    return res.status(200).json({
      success: true,
      message: "Beneficio eliminado exitosamente",
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para eliminar beneficios",
      notFoundMessage: "Beneficio no encontrado",
      internalMessage: "Error al eliminar el beneficio",
    });

    console.error("Error en DELETE /api/beneficios/:id:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};