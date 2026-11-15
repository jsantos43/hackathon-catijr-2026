-- Busca que ignora acentos ("camera" acha "Câmera") — RF21/RF22.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Conta excluída: o usuário é anonimizado (leilões e lances continuam no histórico).
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
