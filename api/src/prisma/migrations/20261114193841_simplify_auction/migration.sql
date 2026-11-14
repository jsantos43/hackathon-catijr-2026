-- DropForeignKey
ALTER TABLE "Auction" DROP CONSTRAINT "Auction_leaderId_fkey";

-- AlterTable
ALTER TABLE "Auction" DROP COLUMN "cancelledAt",
DROP COLUMN "closedAt",
DROP COLUMN "currentPriceCents",
DROP COLUMN "leaderId";

