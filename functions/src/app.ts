import "./config/env.bootstrap";
import express from "express";
import cors, { type CorsOptions } from "cors";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import routes from "./routes";
import publicPaymentsRoutes from "./routes/payments-public.routes";
import { errorHandler, notFoundHandler } from "./utils/error-handler";
import { getSwaggerSpec } from "./config/swagger.config";
import { requestContextMiddleware } from "./middleware/request-context.middleware";
import {
  blockDebugInProduction,
  optionalAppCheckMiddleware,
} from "./utils/middlewares";
import { getAllowedCorsOriginsWithStore } from "./config/cors.config";

const buildCorsOptions = (): CorsOptions => {
  const allowedOrigins = getAllowedCorsOriginsWithStore();
  const isCloudRuntime = Boolean(
    process.env.K_SERVICE || process.env.FUNCTION_NAME,
  );

  if (allowedOrigins.length === 0) {
    if (!isCloudRuntime && process.env.NODE_ENV !== "production") {
      return { origin: true, credentials: true };
    }

    return { origin: false, credentials: true };
  }

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origen no permitido por CORS: ${origin}`));
    },
    credentials: true,
  };
};

let corsOptionsCache: CorsOptions | null = null;

const getCorsOptions = (): CorsOptions => {
  if (!corsOptionsCache) {
    corsOptionsCache = buildCorsOptions();
  }

  return corsOptionsCache;
};

const app = express();
const isProductionRuntime =
  process.env.NODE_ENV === "production" ||
  Boolean(process.env.K_SERVICE || process.env.FUNCTION_NAME);

app.use(
  helmet({
    hsts: isProductionRuntime
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  }),
);
app.use((req, res, next) => cors(getCorsOptions())(req, res, next));
app.use(requestContextMiddleware);
app.use(blockDebugInProduction);
app.use(optionalAppCheckMiddleware);
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

app.use((req, _res, next) => {
  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
  if (isMultipart(req) && Buffer.isBuffer(rawBody) && rawBody.length > 0) {
    req.body = rawBody;
  }
  next();
});

app.use(express.raw({
  type: (req) => isMultipart(req as express.Request),
  limit: "32mb",
}));

app.use((req, res, next) => {
  if (isNotMultipart(req)) {
    express.json({ limit: "32mb" })(req, res, next);
  } else {
    next();
  }
});

app.use((req, res, next) => {
  if (isNotMultipart(req)) {
    express.urlencoded({ limit: "32mb", extended: true })(req, res, next);
  } else {
    next();
  }
});

// Morgan: Logger de peticiones HTTP (solo en desarrollo)
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Swagger UI - solo en desarrollo/local (no exponer en producción)
if (!isProductionRuntime) {
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(getSwaggerSpec(), {
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "Tienda Club León - API Docs",
    }),
  );
}

app.use(publicPaymentsRoutes);
app.use("/api", routes);

// Middleware para rutas no encontradas (404)
app.use(notFoundHandler);

// Middleware global de errores
app.use(errorHandler);

export default app;
