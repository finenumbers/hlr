import { BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { ErrorCodes } from '../../common/errors/error-codes';

/** Soft multer ceiling; tenant-specific maxCsvBytes is enforced in JobsService. */
const MULTER_MAX_BYTES = 52_428_800;

/**
 * Multer interceptor for CSV bulk uploads.
 * Files land in `{uploadDir}/.tmp` then JobsService moves them under the tenant folder.
 * Directory creation is deferred to the first upload (safe at Nest bootstrap).
 */
export function csvUploadInterceptor(uploadDir = process.env.UPLOAD_DIR || './data/uploads') {
  const tmpDir = join(uploadDir, '.tmp');

  return FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        try {
          mkdirSync(tmpDir, { recursive: true });
          cb(null, tmpDir);
        } catch (error) {
          cb(error as Error, tmpDir);
        }
      },
      filename: (_req, file, cb) => {
        const ext = extname(file.originalname || '').toLowerCase() || '.csv';
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: {
      fileSize: MULTER_MAX_BYTES,
      files: 1,
    },
    fileFilter: (_req, file, cb) => {
      const name = (file.originalname || '').toLowerCase();
      const ok =
        name.endsWith('.csv') ||
        name.endsWith('.txt') ||
        file.mimetype === 'text/csv' ||
        file.mimetype === 'text/plain' ||
        file.mimetype === 'application/vnd.ms-excel';
      if (!ok) {
        cb(
          new BadRequestException({
            errorCode: ErrorCodes.VALIDATION_FAILED,
            message: 'Only .csv or .txt phone list files are accepted',
          }),
          false,
        );
        return;
      }
      cb(null, true);
    },
  });
}
