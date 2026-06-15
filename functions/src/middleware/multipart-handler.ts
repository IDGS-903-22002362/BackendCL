import { Request, Response, NextFunction } from "express";
import Busboy from "busboy";

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
            return next(new Error("Solicitud multipart invalida: falta el boundary en Content-Type"));
        }

        const busboy = Busboy({
            headers: req.headers,
            limits: {
                files: options.maxFiles || 10,
                fileSize: options.maxFileSize || 20 * 1024 * 1024,
            },
        });

        const files: MulterFile[] = [];
        const fields: Record<string, any> = {};
        let errorOccurred = false;
        // ✅ Rastrear promesas de cada archivo para esperar que terminen
        const filePromises: Promise<void>[] = [];

        busboy.on("file", (fieldname, file, info) => {
            const { filename, encoding, mimeType } = info;

            if (options.allowedMimeTypes && !options.allowedMimeTypes.includes(mimeType)) {
                file.resume();
                return;
            }

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
                    files.push({
                        fieldname,
                        originalname: filename,
                        encoding,
                        mimetype: mimeType,
                        buffer,
                        size: fileSize,
                    });
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
            if (!errorOccurred) {
                errorOccurred = true;
                next(new Error("Error al procesar archivos: " + (error as Error).message));
            }
        });

        // ✅ Esperar TODAS las promesas de archivos antes de llamar next()
        busboy.on("close", () => {
            if (errorOccurred) return;

            Promise.all(filePromises)
                .then(() => {
                    if (!errorOccurred && !res.headersSent) {
                        req.files = files as any;
                        req.body = { ...req.body, ...fields };
                        next();
                    }
                })
                .catch((err) => {
                    if (!errorOccurred) {
                        errorOccurred = true;
                        next(new Error("Error leyendo archivos: " + err.message));
                    }
                });
        });

        const rawBody = (req as any).rawBody;
        if (Buffer.isBuffer(rawBody) && rawBody.length > 0) {
            try {
                busboy.end(rawBody);
            } catch (error) {
                if (!errorOccurred) {
                    errorOccurred = true;
                    next(error);
                }
            }
            return;
        }

        req.pipe(busboy);
    };
};
