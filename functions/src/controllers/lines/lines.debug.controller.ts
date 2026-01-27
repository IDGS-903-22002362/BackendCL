import { Request, Response } from "express";
import { firestoreTienda } from "../../config/firebase";

/**
 * Controller de Debug para diagnosticar problemas
 */
export const debugFirestore = async (_req: Request, res: Response) => {
    try {
        console.log("🔍 Iniciando diagnóstico de Firestore...");

        // Verificar conexión a Firestore
        const testCollection = firestoreTienda.collection("lineas");
        console.log("✅ Conexión a Firestore establecida");

        // Intentar obtener todos los documentos sin filtros
        const allSnapshot = await testCollection.limit(5).get();
        console.log(`📊 Total de documentos encontrados: ${allSnapshot.size}`);

        const allDocs = allSnapshot.docs.map((doc) => ({
            id: doc.id,
            data: doc.data(),
        }));

        // Intentar query con filtro
        let filteredDocs: Array<{ id: string; data: any }> = [];
        try {
            const filteredSnapshot = await testCollection
                .where("activo", "==", true)
                .limit(5)
                .get();
            console.log(`📊 Documentos con activo=true: ${filteredSnapshot.size}`);
            filteredDocs = filteredSnapshot.docs.map((doc) => ({
                id: doc.id,
                data: doc.data(),
            }));
        } catch (filterError) {
            console.error("❌ Error en query filtrada:", filterError);
        }

        res.status(200).json({
            success: true,
            message: "Diagnóstico completado",
            diagnostico: {
                totalDocumentos: allSnapshot.size,
                documentosActivos: filteredDocs.length,
                muestraDocumentos: allDocs,
                muestraActivos: filteredDocs,
            },
        });
    } catch (error) {
        console.error("❌ Error en diagnóstico:", error);
        res.status(500).json({
            success: false,
            message: "Error en diagnóstico",
            error: error instanceof Error ? error.message : "Error desconocido",
            stack: error instanceof Error ? error.stack : undefined,
        });
    }
};
