import "./config/env.bootstrap";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import routes from "./routes";
import publicPaymentsRoutes from "./routes/payments-public.routes";
import { errorHandler, notFoundHandler } from "./utils/error-handler";
import { getSwaggerSpec } from "./config/swagger.config";
import { requestContextMiddleware } from "./middleware/request-context.middleware";

const app = express();

app.use(helmet());
app.use(cors({ origin: true }));
app.use(requestContextMiddleware);
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use("/api/pagos/webhook", express.raw({ type: "application/json" }));
app.use("/api/webhooks/aplazo", express.raw({ type: "application/json" }));

const isMultipart = (req: express.Request) => {
  const contentType = req.headers["content-type"] || "";
  return contentType.includes("multipart/form-data");
};

const isNotMultipart = (req: express.Request) => {
  return !isMultipart(req);
};

app.use(express.raw({
  type: (req) => isMultipart(req as express.Request),
  limit: "32mb",
}));

app.use((req, res, next) => {
  if (isNotMultipart(req)) {
    express.json({ limit: "500mb" })(req, res, next);
  } else {
    next();
  }
});

app.use((req, res, next) => {
  if (isNotMultipart(req)) {
    express.urlencoded({ limit: "500mb", extended: true })(req, res, next);
  } else {
    next();
  }
});

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

app.use(publicPaymentsRoutes);
app.use("/api", routes);

// Middleware para rutas no encontradas (404)
app.use(notFoundHandler);

// Middleware global de errores
app.use(errorHandler);

export default app;
