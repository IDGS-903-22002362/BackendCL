import { NextFunction, Request, Response } from "express";
import Busboy from "busboy";
import { createWriteStream } from "fs";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { ApiError } from "../utils/error-handler";

type MultipartImagesOptions = {
  fieldName: string;
  maxFiles: number;
  maxFileSizeBytes: number;
};

const BYTES_PER_MB = 1024 * 1024;
const FILE_TYPE_HEADER_BYTES = 4100;

export const parseMultipartImages = ({
  fieldName,
  maxFiles,
  maxFileSizeBytes,
}: MultipartImagesOptions) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const contentType = req.headers["content-type"];

    if (!contentType || !contentType.includes("multipart/form-data")) {
      next(
        new ApiError(
          400,
          "Content-Type inválido. Se requiere multipart/form-data",
        ),
      );
      return;
    }

    if (!contentType.includes("boundary=")) {
      next(
        new ApiError(
          400,
          "Solicitud multipart inválida: falta el boundary en Content-Type",
        ),
      );
      return;
    }

    const files: Express.Multer.File[] = [];
    const bodyFields: Record<string, string | string[]> = {};
    const tempFilePaths = new Set<string>();
    const fileWritePromises: Promise<void>[] = [];
    let completed = false;
    let parsingError: ApiError | null = null;

    const setParsingError = (error: ApiError): void => {
      if (!parsingError) {
        parsingError = error;
      }
    };

    const cleanupTempFiles = async (): Promise<void> => {
      await Promise.allSettled(
        Array.from(tempFilePaths).map(async (filePath) => {
          await fs.unlink(filePath);
        }),
      );
    };

    const fail = (error: unknown): void => {
      if (completed) {
        return;
      }

      completed = true;
      void cleanupTempFiles().finally(() => {
        if (error instanceof ApiError) {
          next(error);
          return;
        }

        if (
          error instanceof Error &&
          error.message === "Unexpected end of form"
        ) {
          next(
            new ApiError(
              400,
              "El multipart/form-data está incompleto o mal formado",
            ),
          );
          return;
        }

        next(new ApiError(400, "No se pudieron procesar los archivos enviados"));
      });
    };

    const parser = Busboy({
      headers: req.headers,
      limits: {
        files: maxFiles,
        fileSize: maxFileSizeBytes,
      },
    });

    parser.on("file", (name, stream, info) => {
      if (name !== fieldName) {
        stream.resume();
        return;
      }

      const { filename, encoding, mimeType } = info;

      if (!mimeType.startsWith("image/")) {
        setParsingError(
          new ApiError(400, "Solo se permiten archivos de imagen"),
        );
        stream.resume();
        return;
      }

      const ext = path.extname(filename || "") || ".bin";
      const tempFilePath = path.join(os.tmpdir(), `ai-upload-${randomUUID()}${ext}`);
      tempFilePaths.add(tempFilePath);
      const writeStream = createWriteStream(tempFilePath, { flags: "wx" });
      let headerBuffer = Buffer.alloc(0);
      let size = 0;

      const writePromise = new Promise<void>((resolve, reject) => {
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
        stream.on("error", reject);
      });
      fileWritePromises.push(writePromise);

      stream.on("data", (chunk: Buffer) => {
        if (parsingError) {
          return;
        }

        size += chunk.length;
        if (headerBuffer.length < FILE_TYPE_HEADER_BYTES) {
          const remainingBytes = FILE_TYPE_HEADER_BYTES - headerBuffer.length;
          headerBuffer = Buffer.concat([
            headerBuffer,
            chunk.subarray(0, remainingBytes),
          ]);
        }
      });

      stream.on("limit", () => {
        setParsingError(
          new ApiError(
            400,
            `El archivo \"${filename || "imagen"}\" excede el límite de ${Math.floor(maxFileSizeBytes / BYTES_PER_MB)}MB`,
          ),
        );
      });

      stream.on("end", () => {
        if (parsingError) {
          return;
        }

        files.push({
          fieldname: name,
          originalname: filename || "imagen",
          encoding,
          mimetype: mimeType,
          size,
          destination: path.dirname(tempFilePath),
          filename: path.basename(tempFilePath),
          path: tempFilePath,
          buffer: headerBuffer,
        } as Express.Multer.File);
      });

      stream.pipe(writeStream);
    });

    parser.on("field", (name, value) => {
      const normalizedName = name.trim();
      if (!normalizedName) {
        return;
      }

      const existingValue = bodyFields[normalizedName];
      if (existingValue === undefined) {
        bodyFields[normalizedName] = value;
        return;
      }

      if (Array.isArray(existingValue)) {
        existingValue.push(value);
        return;
      }

      bodyFields[normalizedName] = [existingValue, value];
    });

    parser.on("filesLimit", () => {
      setParsingError(
        new ApiError(400, `Máximo ${maxFiles} imágenes por solicitud`),
      );
    });

    parser.on("error", fail);

    parser.on("finish", () => {
      if (completed) {
        return;
      }
      void Promise.allSettled(fileWritePromises).then(async (results) => {
        if (completed) {
          return;
        }

        completed = true;

        const rejectedWrite = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );

        if (parsingError || rejectedWrite) {
          await cleanupTempFiles();
          next(
            parsingError ||
              new ApiError(400, "No se pudieron procesar los archivos enviados"),
          );
          return;
        }

        req.file = files[0];
        req.files = files;
        req.body = {
          ...(typeof req.body === "object" && req.body !== null ? req.body : {}),
          ...bodyFields,
        };
        next();
      });
    });

    if (req.rawBody && req.rawBody.length > 0) {
      try {
        parser.end(req.rawBody);
      } catch (error) {
        fail(error);
      }
      return;
    }

    req.pipe(parser);
  };
};
