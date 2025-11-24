/**
 * Configuración principal de Express
 * Define middleware, rutas y configuración general de la aplicación
 */

import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

// Importar rutas
import productsRoutes from "./routes/products.routes";

// Importar utilidades de error
import { errorHandler, notFoundHandler } from "./utils/error-handler";

/**
 * Clase App
 * Encapsula la configuración de Express
 */
class App {
  public app: Application;

  constructor() {
    this.app = express();
    this.config();
    this.routes();
    this.errorHandling();
  }

  /**
   * Configuración de middlewares globales
   */
  private config(): void {
    // Helmet: Añade headers de seguridad
    this.app.use(helmet());

    // CORS: Permitir peticiones desde otros orígenes
    this.app.use(
      cors({
        origin: process.env.CORS_ORIGIN || "*", // En producción, especificar dominio exacto
        credentials: true,
      })
    );

    // Body parser: Parsear JSON
    this.app.use(express.json());

    // Body parser: Parsear URL-encoded
    this.app.use(express.urlencoded({ extended: true }));

    // Morgan: Logger de peticiones HTTP (solo en desarrollo)
    if (process.env.NODE_ENV === "development") {
      this.app.use(morgan("dev"));
    }

    // Configuración adicional
    this.app.set("trust proxy", 1); // Confiar en el primer proxy
  }

  /**
   * Configuración de rutas
   */
  private routes(): void {
    // Ruta de health check
    this.app.get("/health", (_req, res) => {
      res.status(200).json({
        success: true,
        message: "Backend Club León - Tienda API",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    });

    // Ruta raíz
    this.app.get("/", (_req, res) => {
      res.status(200).json({
        success: true,
        message: "⚽ Bienvenido al API de la Tienda del Club León",
        version: "1.0.0",
        endpoints: {
          productos: "/api/productos",
          health: "/health",
        },
      });
    });

    // Montar rutas de módulos
    this.app.use("/api/productos", productsRoutes);

    // Aquí se pueden agregar más rutas en el futuro:
    // this.app.use('/api/categorias', categoriasRoutes);
    // this.app.use('/api/lineas', lineasRoutes);
    // this.app.use('/api/ordenes', ordenesRoutes);
    // this.app.use('/api/usuarios', usuariosRoutes);
  }

  /**
   * Configuración de manejo de errores
   * Debe ser la última configuración
   */
  private errorHandling(): void {
    // Middleware para rutas no encontradas (404)
    this.app.use(notFoundHandler);

    // Middleware global de errores
    this.app.use(errorHandler);
  }
}

// Exportar instancia de la aplicación
export default new App().app;
