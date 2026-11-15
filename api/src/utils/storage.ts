import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

/**
 * Fotos no disco da VM (o RF07, que exigia armazenamento em nuvem, foi riscado do documento).
 * Decisão da equipe: com 1 vCPU e 1 GB de RAM, um serviço a mais (MinIO/S3) custava memória e
 * quebrava a VM. O arquivo fica cru em UPLOADS_DIR e o banco guarda só a chave relativa
 * ("items/<itemId>/<uuid>.jpg"). Em produção o nginx serve /uploads direto do volume, sem
 * passar pelo Node; em dev a própria API serve (app.ts).
 */
export const UPLOADS_ROOT = path.resolve(env.UPLOADS_DIR);
/** Onde o multer grava os arquivos recebidos antes da validação (mesmo disco: rename é atômico). */
export const UPLOADS_TMP = path.join(UPLOADS_ROOT, '.tmp');

export type ImageType = { mime: string; ext: string };

// Tipos aceitos, identificados pelos bytes iniciais do arquivo (não pelo nome nem pelo
// Content-Type que o navegador manda, que podem ser falsificados).
const detectImageType = (buf: Buffer): ImageType | undefined => {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return undefined;
};

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Lê só os primeiros bytes do arquivo (no disco ou em memória) para descobrir o tipo real. */
export const imageTypeOf = async (file: Pick<Express.Multer.File, 'buffer' | 'path'>) => {
  if (file.buffer) return detectImageType(file.buffer);
  const handle = await open(file.path, 'r');
  try {
    const head = Buffer.alloc(12);
    const { bytesRead } = await handle.read(head, 0, 12, 0);
    return detectImageType(head.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
};

export const publicUrl = (key: string) => `${env.UPLOADS_PUBLIC_URL.replace(/\/$/, '')}/${key}`;

/** Caminho absoluto de uma chave, garantindo que não escapa da pasta de uploads. */
const pathOf = (key: string) => {
  const full = path.resolve(UPLOADS_ROOT, key);
  if (!full.startsWith(UPLOADS_ROOT + path.sep)) throw new Error(`Chave de foto inválida: ${key}`);
  return full;
};

/**
 * Guarda as fotos de um item e devolve as chaves, na mesma ordem dos arquivos.
 * Arquivo vindo do multer (no .tmp) é só renomeado; buffer (seed) é gravado.
 */
export const uploadItemImages = async (itemId: string, files: Express.Multer.File[]) => {
  const keys: string[] = [];
  const dir = pathOf(`items/${itemId}/x`);
  await mkdir(path.dirname(dir), { recursive: true });

  try {
    for (const file of files) {
      const type = await imageTypeOf(file);
      if (!type) throw new Error(`Imagem não suportada: ${file.originalname}`);

      const key = `items/${itemId}/${randomUUID()}.${type.ext}`;
      if (file.path) {
        await rename(file.path, pathOf(key));
      } else {
        // Grava num temporário e renomeia: quem lê nunca vê um arquivo pela metade.
        const tmp = path.join(UPLOADS_TMP, `${randomUUID()}.part`);
        await writeFile(tmp, file.buffer);
        await rename(tmp, pathOf(key));
      }
      keys.push(key);
    }
  } catch (err) {
    // Não deixa fotos órfãs se uma delas falhar no meio.
    await deleteObjects(keys);
    throw err;
  }

  return keys;
};

/** Remove fotos do disco. Falhas só são logadas: arquivo sobrando não quebra a operação. */
export const deleteObjects = async (keys: string[]) => {
  await Promise.all(
    keys.map((key) =>
      rm(pathOf(key), { force: true }).catch((err: unknown) => console.error('Falha ao remover foto', key, err)),
    ),
  );
};

/** Apaga temporários do multer que não viraram foto (upload recusado, erro de validação...). */
export const discardTempFiles = async (files: Express.Multer.File[]) => {
  await Promise.all(files.filter((f) => f.path).map((f) => rm(f.path, { force: true }).catch(() => undefined)));
};

/** Roda na subida da API: cria a pasta de uploads e confere se dá para escrever nela. */
export const ensureUploadsDir = async () => {
  await mkdir(UPLOADS_TMP, { recursive: true });
  await access(UPLOADS_ROOT, constants.W_OK);
  console.log(`Fotos em ${UPLOADS_ROOT}`);
};
