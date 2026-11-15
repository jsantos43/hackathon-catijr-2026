/**
 * Migração única: copia para o disco (UPLOADS_DIR) as fotos que estavam no MinIO.
 * O bucket era público para leitura, então basta um GET por foto; não precisa de SDK.
 * As chaves no banco não mudam (items/<itemId>/<uuid>.<ext>), só o lugar do arquivo.
 *
 *   MINIO_URL=http://minio:9000/auction-photos npm run photos:import          # dev
 *   MINIO_URL=http://minio:9000/auction-photos node dist/scripts/import-minio-photos.js
 *
 * Pode rodar quantas vezes quiser: pula o que já existe no disco.
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from '../prisma/db.js';
import { UPLOADS_ROOT } from '../utils/storage.js';

const base = process.env['MINIO_URL']?.replace(/\/$/, '');

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

const main = async () => {
  if (!base) throw new Error('Defina MINIO_URL (ex.: http://minio:9000/auction-photos).');

  const items = await db.item.findMany({ select: { images: true } });
  const keys = items.flatMap((i) => i.images);
  let copied = 0;
  let skipped = 0;
  const missing: string[] = [];

  for (const key of keys) {
    const file = path.resolve(UPLOADS_ROOT, key);
    if (!file.startsWith(UPLOADS_ROOT + path.sep)) continue;
    if (await exists(file)) {
      skipped += 1;
      continue;
    }
    const res = await fetch(`${base}/${key}`);
    if (!res.ok) {
      missing.push(`${key} (${res.status})`);
      continue;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    copied += 1;
  }

  console.log(`Fotos: ${copied} copiadas, ${skipped} já estavam no disco, ${missing.length} não encontradas.`);
  for (const m of missing) console.log(`  faltando: ${m}`);
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
