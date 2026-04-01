import crypto from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";

import multer from "multer";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";

import { moderateTextInputs } from "../utils/moderator";

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_METADATA_BYTES = 4096;
const MAX_FILENAME_LENGTH = 255;

const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const restrictedExtensions = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".php",
  ".js",
  ".jar",
  ".msi",
]);

const extensionMimeMap: Record<string, string[]> = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".gif": ["image/gif"],
};

const signatureByMime: Record<string, (buffer: Buffer) => boolean> = {
  "image/jpeg": (buffer) => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  "image/png": (buffer) =>
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a,
  "image/gif": (buffer) =>
    buffer.length > 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x39 || buffer[4] === 0x37) &&
    buffer[5] === 0x61,
  "image/webp": (buffer) =>
    buffer.length > 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50,
};

export class UploadValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const uploadImagesMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
    files: MAX_IMAGES,
  },
}).array("images", MAX_IMAGES);

function validateMetadata(file: Express.Multer.File): void {
  if (!file.originalname || file.originalname.length > MAX_FILENAME_LENGTH) {
    throw new UploadValidationError("Invalid filename metadata");
  }

  const metadataString = JSON.stringify({
    originalname: file.originalname,
    mimetype: file.mimetype,
    encoding: file.encoding,
    fieldname: file.fieldname,
  });

  if (Buffer.byteLength(metadataString, "utf8") > MAX_METADATA_BYTES) {
    throw new UploadValidationError("File metadata exceeds allowed limits");
  }
}

function validateFile(file: Express.Multer.File): void {
  validateMetadata(file);

  const extension = path.extname(file.originalname).toLowerCase();
  if (restrictedExtensions.has(extension)) {
    throw new UploadValidationError("Restricted file extension", 415);
  }

  if (!allowedExtensions.has(extension)) {
    throw new UploadValidationError("Unsupported file extension", 415);
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new UploadValidationError("File exceeds 10MB size limit", 413);
  }

  const acceptedMimes = extensionMimeMap[extension] ?? [];
  if (!acceptedMimes.includes(file.mimetype)) {
    throw new UploadValidationError("File extension and MIME type mismatch", 415);
  }

  const signatureValidator = signatureByMime[file.mimetype];
  if (!signatureValidator || !signatureValidator(file.buffer)) {
    throw new UploadValidationError("File signature does not match declared format", 415);
  }

  const filenameIssues = moderateTextInputs({ filename: path.parse(file.originalname).name });
  if (filenameIssues.length > 0) {
    throw new UploadValidationError("Filename contains blocked content or possible PII", 422);
  }
}

function normalizeFiles(files: Express.Multer.File[] | undefined): Express.Multer.File[] {
  if (!files || files.length === 0) {
    return [];
  }

  if (files.length > MAX_IMAGES) {
    throw new UploadValidationError("Maximum of 5 images allowed", 400);
  }

  return files;
}

export async function validateAndPersistImages(
  connection: PoolConnection,
  files: Express.Multer.File[] | undefined,
  incidentId: number,
  uploadedBy: number,
): Promise<{ refs: string[]; diskPaths: string[] }> {
  const safeFiles = normalizeFiles(files);
  if (safeFiles.length === 0) {
    return { refs: [], diskPaths: [] };
  }

  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"), "incidents");
  await mkdir(uploadDir, { recursive: true });

  const refs: string[] = [];
  const diskPaths: string[] = [];

  for (const file of safeFiles) {
    validateFile(file);
    const extension = path.extname(file.originalname).toLowerCase();
    const safeName = `${crypto.randomUUID()}${extension}`;
    const absolutePath = path.join(uploadDir, safeName);
    const relativeRef = `uploads/incidents/${safeName}`;

    await writeFile(absolutePath, file.buffer);

    await connection.execute<ResultSetHeader>(
      "INSERT INTO images (incident_id, file_ref, uploaded_by) VALUES (?, ?, ?)",
      [incidentId, relativeRef, uploadedBy],
    );

    refs.push(relativeRef);
    diskPaths.push(absolutePath);
  }

  return { refs, diskPaths };
}

export async function cleanupFiles(diskPaths: string[]): Promise<void> {
  await Promise.all(
    diskPaths.map(async (p) => {
      try {
        await unlink(p);
      } catch {
        // swallow cleanup errors
      }
    }),
  );
}
