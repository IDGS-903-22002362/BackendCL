/**
 * FIREBASE FUNCTIONS ENTRY POINTO
 * ---------------------------------------------------------------------
 * Este es el ÚNICO archivo que Firebase lee directamente al iniciar.
 * Su responsabilidad es exportar los triggers de Cloud Functions.
 *
 * NOTA DE ARQUITECTURA:
 * Mantenemos este archivo minimalista. La lógica de la aplicación Express
 * vive en "app.ts", permitiendo que sea testeable independientemente
 * del entorno de Firebase.
 */

import * as functions from "firebase-functions";
import app from "./app";

// Exportar la API de Express como una Cloud Function HTTPS
export const api = functions.https.onRequest(app);
