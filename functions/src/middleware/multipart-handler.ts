import { Request, Response, NextFunction } from "express";
import Busboy from "busboy";
import { Storage } from "@google-cloud/storage";
import { v4 as uuidv4 } from "uuid";

// Configuración
const storage = new Storage();
const bucket = storage.bucket(process.env.APP_OFICIAL_STORAGE_BUCKET!);

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
    return async (req: Request, res: Response, next: NextFunction) => {
        const contentType = req.headers["content-type"];

        if (!contentType || !contentType.includes("multipart/form-data")) {
            return next();
        }

        const busboy = Busboy({
            headers: req.headers,
            limits: {
                files: options.maxFiles || 10,
                fileSize: options.maxFileSize || 20 * 1024 * 1024, // 20MB default
            },
        });

        const files: MulterFile[] = [];
        const fields: Record<string, any> = {};

        busboy.on("file", (fieldname, file, info) => {
            const { filename, encoding, mimeType } = info;

            // Validar tipo de archivo
            if (options.allowedMimeTypes && !options.allowedMimeTypes.includes(mimeType)) {
                file.resume();
                return;
            }

            const chunks: Buffer[] = [];
            let fileSize = 0;

            file.on("data", (chunk: Buffer) => {
                chunks.push(chunk);
                fileSize += chunk.length;
            });

            file.on("end", () => {
                const buffer = Buffer.concat(chunks);
                files.push({
                    fieldname,
                    originalname: filename,
                    encoding,
                    mimetype: mimeType,
                    buffer,
                    size: fileSize,
                });
            });
        });

        busboy.on("field", (fieldname, value) => {
            fields[fieldname] = value;
        });

        busboy.on("error", (error) => {
            console.error("Busboy error:", error);
            res.status(400).json({
                success: false,
                message: "Error al procesar archivos",
            });
        });

        busboy.on("close", () => {
            req.files = files as any;
            req.body = fields;
            next();
        });

        // Pipe request to busboy
        req.pipe(busboy);
    };
};