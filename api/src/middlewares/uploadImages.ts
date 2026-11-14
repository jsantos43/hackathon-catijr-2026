import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { InvalidRequest } from '../errors/index.js';
import { ACCEPTED_IMAGE_TYPES, imageTypeOf } from '../utils/storage.js';

// RF07: os arquivos ficam só em memória até irem para o bucket; nada é gravado no disco da VM.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.PHOTO_MAX_BYTES, files: env.ITEM_MAX_PHOTOS, fields: 20 },
  fileFilter: (_req, file, cb) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.mimetype)) {
      return cb(new InvalidRequest(`${file.originalname}: only JPEG, PNG or WEBP images are accepted`));
    }
    return cb(null, true);
  },
});

/**
 * Recebe multipart/form-data com as fotos no campo `images`.
 * `required`: exige o mínimo de fotos (criação). Sem `required`, enviar fotos é opcional,
 * mas quem enviar substitui todas e também precisa respeitar o mínimo.
 */
const uploadImages =
  ({ required }: { required: boolean }) =>
  (req: Request, res: Response, next: NextFunction) =>
    upload.array('images', env.ITEM_MAX_PHOTOS)(req, res, (err?: unknown) => {
      if (err) return next(err);

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      req.body ??= {};

      if (!files.length && !required) return next();

      if (files.length < env.ITEM_MIN_PHOTOS) {
        return next(new InvalidRequest(`images: send at least ${env.ITEM_MIN_PHOTOS} photos`));
      }

      // O mimetype vem do navegador; confere o conteúdo real do arquivo.
      const invalid = files.filter((f) => !imageTypeOf(f.buffer)).map((f) => f.originalname);
      if (invalid.length) {
        return next(new InvalidRequest(invalid.map((name) => `${name}: file is not a valid image`)));
      }

      return next();
    });

export default uploadImages;
