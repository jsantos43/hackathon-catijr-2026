-- Leilão passa a vender um lote de itens (N:N via AuctionItem) e ganha título/descrição próprios.

-- CreateTable
CREATE TABLE "AuctionItem" (
    "auctionId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "AuctionItem_pkey" PRIMARY KEY ("auctionId","itemId")
);

-- Preserva os leilões existentes: cada um vira um lote com o seu único item, e o título/descrição
-- vêm do item.
INSERT INTO "AuctionItem" ("auctionId", "itemId", "position")
SELECT "id", "itemId", 0 FROM "Auction";

ALTER TABLE "Auction" ADD COLUMN "title" TEXT, ADD COLUMN "description" TEXT;

UPDATE "Auction" a SET "title" = i."name", "description" = i."description"
FROM "Item" i WHERE i."id" = a."itemId";

ALTER TABLE "Auction" ALTER COLUMN "title" SET NOT NULL, ALTER COLUMN "description" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "Auction" DROP CONSTRAINT "Auction_itemId_fkey";

-- DropIndex
DROP INDEX "Auction_itemId_idx";

-- AlterTable
ALTER TABLE "Auction" DROP COLUMN "itemId";

-- CreateIndex
CREATE INDEX "AuctionItem_itemId_idx" ON "AuctionItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionItem_auctionId_position_key" ON "AuctionItem"("auctionId", "position");

-- AddForeignKey
ALTER TABLE "AuctionItem" ADD CONSTRAINT "AuctionItem_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionItem" ADD CONSTRAINT "AuctionItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
