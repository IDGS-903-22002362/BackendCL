import { NextFunction, Request, Response } from "express";
import Busboy from "busboy";
import { ApiError } from "../utils/error-handler";

type MultipartImagesOptions = {
  fieldName: string;
  maxFiles: number;
  maxFileSizeBytes: number;
};

const BYTES_PER_MB = 1024 * 1024;

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
    let completed = false;
    let parsingError: ApiError | null = null;

    const setParsingError = (error: ApiError): void => {
      if (!parsingError) {
        parsingError = error;
      }
    };

    const fail = (error: unknown): void => {
      if (completed) {
        return;
      }

      completed = true;

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

      const chunks: Buffer[] = [];
      let size = 0;

      stream.on("data", (chunk: Buffer) => {
        if (parsingError) {
          return;
        }

        chunks.push(chunk);
        size += chunk.length;
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
          buffer: Buffer.concat(chunks),
        } as Express.Multer.File);
      });
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

      completed = true;

      if (parsingError) {
        next(parsingError);
        return;
      }

      req.files = files;
      next();
    });

    if (req.rawBody && req.rawBody.length > 0) {
      parser.end(req.rawBody);
      return;
    }

    req.pipe(parser);
  };
};
