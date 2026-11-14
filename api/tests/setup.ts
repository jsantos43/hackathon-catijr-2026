import { afterAll, vi } from 'vitest';

// Fotos: nos testes nada vai para o MinIO. As chaves são inventadas, mas no formato real.
vi.mock('../src/utils/storage.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils/storage.js')>();
  return {
    ...original,
    uploadItemImages: vi.fn(async (itemId: string, files: unknown[]) =>
      files.map((_, i) => `items/${itemId}/foto-${i}.png`),
    ),
    deleteObjects: vi.fn(async () => undefined),
    ensureBucket: vi.fn(async () => undefined),
  };
});

afterAll(async () => {
  const { db } = await import('../src/prisma/db.js');
  const { closeRedis } = await import('../src/redis/client.js');
  await db.$disconnect();
  await closeRedis();
});
