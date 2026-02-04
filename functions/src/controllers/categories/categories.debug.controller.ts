import { Request, Response } from "express";
import { firestoreTienda } from "../../config/firebase";

/**
 * Endpoint de diagnóstico para verificar conexión a Firestore
 * y estado de la colección de categorías
 * GET /api/categorias/debug
 */
export const debugFirestore = async (_req: Request, res: Response) => {
  try {
    const testCollection = firestoreTienda.collection("categorias");

    // Obtener todos los documentos (máximo 5 para muestra)
    const allSnapshot = await testCollection.limit(5).get();
    const allDocs = allSnapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    }));

    // Obtener documentos activos
    const activeSnapshot = await testCollection
      .where("activo", "==", true)
      .get();
    const activeDocs = activeSnapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    }));

    // Obtener documentos inactivos
    const inactiveSnapshot = await testCollection
      .where("activo", "==", false)
      .get();
    const inactiveDocs = inactiveSnapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    }));

    res.status(200).json({
      success: true,
      message: "Diagnóstico de Firestore completado",
      diagnostico: {
        coleccion: "categorias",
        totalDocumentos: allSnapshot.size,
        documentosActivos: activeSnapshot.size,
        documentosInactivos: inactiveSnapshot.size,
        muestraDocumentos: allDocs,
        muestraActivos: activeDocs.slice(0, 3),
        muestraInactivos: inactiveDocs.slice(0, 3),
      },
    });
  } catch (error) {
    console.error("Error en diagnóstico de Firestore (categorías):", error);
    res.status(500).json({
      success: false,
      message: "Error en diagnóstico de Firestore",
      error: error instanceof Error ? error.message : "Error desconocido",
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
};
