import { Request, Response } from "express";
import { firestoreTienda } from "../../config/firebase";

/**
 * GET /api/proveedores/debug
 * Endpoint de diagnóstico para verificar la conexión con Firestore
 * Solo para desarrollo
 */
export const debugFirestore = async (_req: Request, res: Response) => {
  try {
    const testCollection = firestoreTienda.collection("proveedores");

    // Intentar obtener todos los documentos (limit para no sobrecargar)
    const allSnapshot = await testCollection.limit(5).get();

    // Obtener documentos activos
    const activeSnapshot = await testCollection
      .where("activo", "==", true)
      .get();

    // Obtener documentos inactivos
    const inactiveSnapshot = await testCollection
      .where("activo", "==", false)
      .get();

    // Preparar datos de muestra
    const sampleDocs = allSnapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    }));

    const activeDocs = activeSnapshot.docs.map((doc) => ({
      id: doc.id,
      nombre: doc.data().nombre,
      activo: doc.data().activo,
    }));

    res.status(200).json({
      success: true,
      message: "Diagnóstico de Firestore completado",
      diagnostico: {
        coleccion: "proveedores",
        totalDocumentos: allSnapshot.size,
        documentosActivos: activeSnapshot.size,
        documentosInactivos: inactiveSnapshot.size,
        muestraDocumentos: sampleDocs,
        listaActivos: activeDocs,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error en debug de proveedores:", error);
    res.status(500).json({
      success: false,
      message: "Error al realizar diagnóstico de Firestore",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
