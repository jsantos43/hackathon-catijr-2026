import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { InvalidRequest } from '../errors/index.js';
import { ACCEPTED_IMAGE_TYPES, UPLOADS_TMP, discardTempFiles, imageTypeOf } from '../utils/storage.js';

// Os arquivos vão direto para o disco (pasta .tmp de uploads), não para a memória: com 1 GB de
// RAM, 8 fotos de 5 MB por requisição em memória pesariam. Depois de validados, o service só
// renomeia para o lugar definitivo. O que sobrar no .tmp é apagado quando a resposta termina.
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOADS_TMP }),
  limits: { fileSize: env.PHOTO_MAX_BYTES, files: env.ITEM_MAX_PHOTOS, fields: 20 },
  fileFilter: (_req, file, cb) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.mimetype)) {
      return cb(new InvalidRequest(`${file.originalname}: só aceitamos fotos JPG, PNG ou WebP`));
    }
    return cb(null, true);
  },
});

/** Recebe multipart/form-data com as fotos no campo `images`. */
class Upload {
  /**
   * `required`: exige o mínimo de fotos (criação). Sem `required` (edição), qualquer quantidade
   * serve aqui: o service soma com as fotos mantidas (keepImages) e confere o total.
   */
  static images({ required }: { required: boolean }) {
    return (req: Request, res: Response, next: NextFunction) =>
      upload.array('images', env.ITEM_MAX_PHOTOS)(req, res, (err?: unknown) => {
        if (err) return next(err);

        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        req.body ??= {};
        // Seja qual for o resultado, nada fica esquecido no .tmp (as fotos aceitas já saíram de lá).
        res.on('close', () => void discardTempFiles(files));

        if (!files.length && !required) return next();

        if (required && files.length < env.ITEM_MIN_PHOTOS) {
          return next(new InvalidRequest(`images: envie pelo menos ${env.ITEM_MIN_PHOTOS} fotos`));
        }

        // O mimetype vem do navegador; confere o conteúdo real do arquivo.
        Promise.all(files.map(imageTypeOf))
          .then((types) => {
            const invalid = files.filter((_, i) => !types[i]).map((f) => f.originalname);
            if (invalid.length) {
              return next(new InvalidRequest(invalid.map((name) => `${name}: o arquivo não é uma imagem válida`)));
            }
            return next();
          })
          .catch(next);
      });
  }
}

export default Upload;
