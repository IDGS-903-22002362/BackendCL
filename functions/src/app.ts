import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import routes from "./routes";
import { errorHandler, notFoundHandler } from "./utils/error-handler";
import { getSwaggerSpec } from "./config/swagger.config";
import type { Request as ExpressRequest } from "express";
import dotenv from "dotenv";
import path from "path";


dotenv.config({
  path: path.resolve(__dirname, "../.env"),
});

const app = express();

app.use(helmet());
app.use(cors({ origin: true }));
app.use(
  express.json({
    verify: (req, _res, buf) => {
      const expressReq = req as ExpressRequest;
      if (expressReq.originalUrl.startsWith("/api/pagos/webhook")) {
        expressReq.rawBody = Buffer.from(buf);
      }
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// Morgan: Logger de peticiones HTTP (solo en desarrollo)
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Swagger UI - Documentación interactiva de la API
// Accesible en: http://localhost:3000/api-docs
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(getSwaggerSpec(), {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Tienda Club León - API Docs",
  }),
);

app.use("/api", routes);

// Middleware para rutas no encontradas (404)
app.use(notFoundHandler);

// Middleware global de errores
app.use(errorHandler);

export default app;
