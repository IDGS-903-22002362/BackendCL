/**
 * Servicio para gestión de Tallas
 * Implementa operaciones CRUD con validaciones
 */

import { firestoreTienda } from "../config/firebase";
import { Talla, CrearTallaDTO } from "../models/catalogo.model";

const COLLECTION_NAME = "tallas";

/**
 * Obtener todas las tallas
 * Retorna solo tallas, ordenadas por campo 'orden' si existe
 */
export async function getAllSizes(): Promise<Talla[]> {
  try {
    const snapshot = await firestoreTienda
      .collection(COLLECTION_NAME)
      .orderBy("orden", "asc")
      .get();

    const sizes: Talla[] = [];
    snapshot.forEach((doc) => {
      sizes.push({
        id: doc.id,
        ...doc.data(),
      } as Talla);
    });

    return sizes;
  } catch (error) {
    console.error("Error al obtener tallas:", error);
    throw new Error("Error al obtener tallas de Firestore");
  }
}

/**
 * Obtener talla por ID
 * @param id ID de la talla
 */
export async function getSizeById(id: string): Promise<Talla | null> {
  try {
    const doc = await firestoreTienda.collection(COLLECTION_NAME).doc(id).get();

    if (!doc.exists) {
      return null;
    }

    return {
      id: doc.id,
      ...doc.data(),
    } as Talla;
  } catch (error) {
    console.error("Error al obtener talla por ID:", error);
    throw new Error("Error al obtener talla de Firestore");
  }
}

/**
 * Crear nueva talla
 * Valida campos requeridos y unicidad de código
 * @param data DTO con datos de la talla
 */
export async function createSize(
  data: CrearTallaDTO,
): Promise<{ id: string; talla: Talla }> {
  try {
    // Validar campos requeridos
    if (!data.codigo || !data.descripcion) {
      throw new Error("Los campos 'codigo' y 'descripcion' son requeridos");
    }

    // Validar que no estén vacíos después de trim
    if (data.codigo.trim() === "" || data.descripcion.trim() === "") {
      throw new Error(
        "Los campos 'codigo' y 'descripcion' no pueden estar vacíos",
      );
    }

    // Validar que el código sea único
    const existingByCode = await firestoreTienda
      .collection(COLLECTION_NAME)
      .where("codigo", "==", data.codigo.trim())
      .limit(1)
      .get();

    if (!existingByCode.empty) {
      throw new Error(`Ya existe una talla con el código "${data.codigo}"`);
    }

    // Generar ID semántico basado en el código (lowercase, sin espacios)
    const id = data.codigo.toLowerCase().replace(/\s+/g, "_");

    // Verificar que el ID no exista
    const docRef = firestoreTienda.collection(COLLECTION_NAME).doc(id);
    const existingDoc = await docRef.get();

    if (existingDoc.exists) {
      throw new Error(`Ya existe una talla con el ID "${id}"`);
    }

    // Preparar datos de la talla
    const talla: Talla = {
      id,
      codigo: data.codigo.trim(),
      descripcion: data.descripcion.trim(),
      orden: data.orden ?? 999, // Por defecto al final
    };

    // Guardar en Firestore
    await docRef.set(talla);

    return { id, talla };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    console.error("Error al crear talla:", error);
    throw new Error("Error al crear talla en Firestore");
  }
}

/**
 * Actualizar talla existente
 * @param id ID de la talla
 * @param data Datos parciales a actualizar
 */
export async function updateSize(
  id: string,
  data: Partial<CrearTallaDTO>,
): Promise<Talla> {
  try {
    const docRef = firestoreTienda.collection(COLLECTION_NAME).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error(`Talla con ID "${id}" no encontrada`);
    }

    // Validar unicidad de código si se está actualizando
    if (data.codigo) {
      if (data.codigo.trim() === "") {
        throw new Error("El código de la talla no puede estar vacío");
      }

      const existingByCode = await firestoreTienda
        .collection(COLLECTION_NAME)
        .where("codigo", "==", data.codigo.trim())
        .limit(1)
        .get();

      if (!existingByCode.empty && existingByCode.docs[0].id !== id) {
        throw new Error(`Ya existe otra talla con el código "${data.codigo}"`);
      }
    }

    // Validar descripción si se está actualizando
    if (data.descripcion !== undefined && data.descripcion.trim() === "") {
      throw new Error("La descripción de la talla no puede estar vacía");
    }

    // Preparar datos de actualización
    const updateData: Partial<Talla> = {};
    if (data.codigo) updateData.codigo = data.codigo.trim();
    if (data.descripcion) updateData.descripcion = data.descripcion.trim();
    if (data.orden !== undefined) updateData.orden = data.orden;

    // Actualizar en Firestore
    await docRef.update(updateData);

    // Obtener y retornar talla actualizada
    const updatedDoc = await docRef.get();
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as Talla;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    console.error("Error al actualizar talla:", error);
    throw new Error("Error al actualizar talla en Firestore");
  }
}

/**
 * Eliminar talla (eliminación física ya que no tiene campo 'activo')
 * @param id ID de la talla
 */
export async function deleteSize(id: string): Promise<void> {
  try {
    const docRef = firestoreTienda.collection(COLLECTION_NAME).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error(`Talla con ID "${id}" no encontrada`);
    }

    // Eliminar el documento físicamente
    await docRef.delete();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    console.error("Error al eliminar talla:", error);
    throw new Error("Error al eliminar talla en Firestore");
  }
}
