import { Request, Response, NextFunction } from "express";
import Busboy from "busboy";
import { ApiError } from "../utils/error-handler";

interface MulterFile {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    buffer: Buffer;
    size: number;
}

export const handleMultipart = (options: {
    maxFiles?: number;
    maxFileSize?: number;
    allowedMimeTypes?: string[];
}) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const contentType = req.headers["content-type"];

        if (!contentType || !contentType.includes("multipart/form-data")) {
            return next();
        }

        if (!contentType.includes("boundary=")) {
            return next(new ApiError(400, "Solicitud multipart invalida: falta el boundary en Content-Type"));
        }

        const busboy = Busboy({
            headers: req.headers,
            limits: {
                files: options.maxFiles || 10,
                fileSize: options.maxFileSize || 20 * 1024 * 1024,
            },
        });

        const files: Array<MulterFile | undefined> = [];
        const fields: Record<string, any> = {};
        let errorOccurred = false;
        let nextFileIndex = 0;
        // ✅ Rastrear promesas de cada archivo para esperar que terminen
        const filePromises: Promise<void>[] = [];

        busboy.on("file", (fieldname, file, info) => {
            const { filename, encoding, mimeType } = info;

            if (options.allowedMimeTypes && !options.allowedMimeTypes.includes(mimeType)) {
                file.resume();
                return;
            }

            const fileIndex = nextFileIndex++;

            // ✅ Cada archivo es una promesa que resuelve en su evento "end"
            const filePromise = new Promise<void>((resolve, reject) => {
                const chunks: Buffer[] = [];
                let fileSize = 0;

                file.on("data", (chunk: Buffer) => {
                    if (errorOccurred) {
                        return;
                    }

                    chunks.push(chunk);
                    fileSize += chunk.length;
                });

                file.on("limit", () => {
                    file.resume();
                    reject(new Error(`El archivo "${filename || "archivo"}" excede el limite permitido`));
                });

                file.on("end", () => {
                    if (errorOccurred) {
                        resolve();
                        return;
                    }

                    const buffer = Buffer.concat(chunks);
                    files[fileIndex] = {
                        fieldname,
                        originalname: filename,
                        encoding,
                        mimetype: mimeType,
                        buffer,
                        size: fileSize,
                    };
                    resolve();
                });

                file.on("error", reject);
            });

            filePromises.push(filePromise);
        });

        busboy.on("field", (fieldname, value) => {
            fields[fieldname] = value;
        });

        busboy.on("error", (error) => {
            if (errorOccurred) {
                return;
            }
            errorOccurred = true;
            const message = (error as Error).message || "Error desconocido";
            try {
                if (typeof req.unpipe === "function") {
                    req.unpipe(busboy);
                }
            } catch {
                // ignore cleanup errors
            }
            next(new ApiError(400, "Error al procesar archivos: " + message));
        });

        req.on?.("error", (error: Error) => {
            if (!errorOccurred) {
                errorOccurred = true;
                next(
                    new ApiError(
                        400,
                        "Error al leer la solicitud multipart: " + error.message,
                    ),
                );
            }
        });

        // ✅ Esperar TODAS las promesas de archivos antes de llamar next()
        busboy.on("close", () => {
            if (errorOccurred) return;

            Promise.all(filePromises)
                .then(() => {
                    if (!errorOccurred && !res.headersSent) {
                        req.files = files.filter(
                            (file): file is MulterFile => file !== undefined,
                        ) as any;
                        req.body = { ...req.body, ...fields };
                        next();
                    }
                })
                .catch((err) => {
                    if (!errorOccurred) {
                        errorOccurred = true;
                        next(new ApiError(400, "Error leyendo archivos: " + err.message));
                    }
                });
        });

        const parseBufferedBody = (body: Buffer | string): boolean => {
            const declaredLength = Number.parseInt(
                String(req.headers["content-length"] ?? ""),
                10,
            );
            if (
                Buffer.isBuffer(body) &&
                Number.isFinite(declaredLength) &&
                declaredLength > 0 &&
                body.length < declaredLength
            ) {
                if (!errorOccurred) {
                    errorOccurred = true;
                    next(
                        new ApiError(
                            400,
                            "El cuerpo multipart llego incompleto al servidor",
                        ),
                    );
                }
                return true;
            }

            try {
                busboy.end(body);
            } catch (error) {
                if (!errorOccurred) {
                    errorOccurred = true;
                    next(
                        error instanceof ApiError
                            ? error
                            : new ApiError(
                                  400,
                                  error instanceof Error
                                      ? error.message
                                      : "Error al procesar multipart",
                              ),
                    );
                }
            }
            return true;
        };

        const rawBody = (req as any).rawBody;
        if (Buffer.isBuffer(rawBody) && rawBody.length > 0) {
            parseBufferedBody(rawBody);
            return;
        }

        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            parseBufferedBody(req.body);
            return;
        }

        if (typeof req.body === "string" && req.body.length > 0) {
            parseBufferedBody(req.body);
            return;
        }

        if (process.env.K_SERVICE || process.env.FUNCTION_NAME) {
            console.error("Multipart body no disponible en Cloud Functions", {
                contentLength: req.headers["content-length"],
                contentType,
                hasRawBody: Buffer.isBuffer(rawBody),
                rawBodyLength: Buffer.isBuffer(rawBody) ? rawBody.length : 0,
                bodyType: typeof req.body,
                bodyIsBuffer: Buffer.isBuffer(req.body),
                bodyLength: Buffer.isBuffer(req.body) ? req.body.length : 0,
                readableEnded: req.readableEnded,
                readableLength: req.readableLength,
            });
            return next(new ApiError(400, "No se pudo leer el cuerpo multipart en el entorno desplegado"));
        }

        req.pipe(busboy);
    };
};
