import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

// RF07: as fotos ficam só no bucket. No banco guardamos apenas a chave do objeto.
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
});

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

export const imageTypeOf = detectImageType;

export const publicUrl = (key: string) =>
  `${env.S3_PUBLIC_URL.replace(/\/$/, '')}/${env.S3_BUCKET}/${key}`;

/** Sobe as fotos de um item e devolve as chaves, na mesma ordem dos arquivos. */
export const uploadItemImages = async (itemId: string, files: Express.Multer.File[]) => {
  const keys: string[] = [];

  try {
    for (const file of files) {
      const type = detectImageType(file.buffer);
      if (!type) throw new Error(`Unsupported image: ${file.originalname}`);

      const key = `items/${itemId}/${randomUUID()}.${type.ext}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: file.buffer,
          ContentType: type.mime,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      keys.push(key);
    }
  } catch (err) {
    // Não deixa fotos órfãs no bucket se uma delas falhar no meio.
    await deleteObjects(keys);
    throw err;
  }

  return keys;
};

/** Remove objetos do bucket. Falhas só são logadas: lixo no bucket não quebra a operação. */
export const deleteObjects = async (keys: string[]) => {
  if (!keys.length) return;

  try {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: env.S3_BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  } catch (err) {
    console.error('Falha ao remover fotos do bucket', err);
  }
};

/**
 * Garante que o bucket existe e que as fotos podem ser lidas publicamente pelo navegador.
 * Roda na subida da API; no provedor de nuvem o bucket pode já vir criado e com a política certa.
 */
export const ensureBucket = async () => {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
      console.log(`Bucket "${env.S3_BUCKET}" criado`);
    } catch (err) {
      console.error(`Não foi possível criar o bucket "${env.S3_BUCKET}"`, err);
      return;
    }
  }

  // Idempotente: aplica sempre, para um bucket criado à mão também ficar legível.
  try {
    await s3.send(
      new PutBucketPolicyCommand({
        Bucket: env.S3_BUCKET,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${env.S3_BUCKET}/*`],
            },
          ],
        }),
      }),
    );
  } catch (err) {
    console.error(`Não foi possível liberar leitura pública no bucket "${env.S3_BUCKET}"`, err);
  }
};
