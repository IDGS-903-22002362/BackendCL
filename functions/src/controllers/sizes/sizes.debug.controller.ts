/**
 * Controlador de Debug para Tallas
 * Endpoint de diagnóstico para verificar conexión a Firestore
 */

import { Request, Response } from "express";
import { firestoreTienda } from "../../config/firebase";

/**
 * GET /api/tallas/debug
 * Diagnóstico de conexión a Firestore para colección tallas
 */
export async function debugFirestore(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const collection = firestoreTienda.collection("tallas");

    // 1. Obtener todos los documentos
    const allSnapshot = await collection.get();
    const allDocs = allSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // 2. Obtener documentos ordenados por 'orden'
    const orderedSnapshot = await collection.orderBy("orden", "asc").get();
    const orderedDocs = orderedSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json({
      success: true,
      message: "Diagnóstico de Firestore completado",
      diagnostico: {
        coleccion: "tallas",
        totalDocumentos: allDocs.length,
        muestraDocumentos: allDocs.slice(0, 5),
        documentosOrdenados: orderedDocs.slice(0, 10),
      },
    });
  } catch (error) {
    console.error("Error en debug tallas:", error);
    res.status(500).json({
      success: false,
      message: "Error al ejecutar diagnóstico",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
}
