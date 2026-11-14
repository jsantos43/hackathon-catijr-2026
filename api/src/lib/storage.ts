import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

// Cliente S3 genérico: localmente aponta para o MinIO; em produção basta trocar as variáveis
// para o storage em nuvem fornecido pela organização.
export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

export const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type AllowedImageType = keyof typeof ALLOWED_IMAGE_TYPES;

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function uploadImage(body: Buffer, mimeType: AllowedImageType, prefix = "items") {
  const key = `${prefix}/${randomUUID()}.${ALLOWED_IMAGE_TYPES[mimeType]}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: mimeType,
    }),
  );

  return key;
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

/**
 * Garante que o bucket existe e que as fotos têm leitura pública (as listagens são públicas).
 * Tenta algumas vezes porque o storage pode ainda estar subindo junto com a API.
 */
export async function ensureBucket(attempts = 15, delayMs = 2000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
      } catch (err: any) {
        if (err?.$metadata?.httpStatusCode !== 404) throw err;
        await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
        console.log(`Bucket "${env.S3_BUCKET}" criado`);
      }

      await s3.send(
        new PutBucketPolicyCommand({
          Bucket: env.S3_BUCKET,
          Policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { AWS: ["*"] },
                Action: ["s3:GetObject"],
                Resource: [`arn:aws:s3:::${env.S3_BUCKET}/*`],
              },
            ],
          }),
        }),
      );
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.warn(`Storage indisponível (tentativa ${i}/${attempts}), tentando de novo...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export function publicUrl(key: string) {
  return `${env.S3_PUBLIC_URL.replace(/\/$/, "")}/${env.S3_BUCKET}/${key}`;
}
