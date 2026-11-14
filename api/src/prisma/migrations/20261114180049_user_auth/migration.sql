-- DropForeignKey
ALTER TABLE "Auction" DROP CONSTRAINT "Auction_itemId_fkey";

-- DropForeignKey
ALTER TABLE "Auction" DROP CONSTRAINT "Auction_leaderId_fkey";

-- DropForeignKey
ALTER TABLE "Auction" DROP CONSTRAINT "Auction_sellerId_fkey";

-- DropForeignKey
ALTER TABLE "Bid" DROP CONSTRAINT "Bid_auctionId_fkey";

-- DropForeignKey
ALTER TABLE "Bid" DROP CONSTRAINT "Bid_bidderId_fkey";

-- DropForeignKey
ALTER TABLE "Item" DROP CONSTRAINT "Item_sellerId_fkey";

-- DropForeignKey
ALTER TABLE "ItemPhoto" DROP CONSTRAINT "ItemPhoto_itemId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "displayName",
DROP COLUMN "passwordHash",
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "password" TEXT NOT NULL,
ADD COLUMN     "refreshTokenExpires" TIMESTAMPTZ(3),
ADD COLUMN     "refreshTokenHash" TEXT,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(3) NOT NULL;

-- DropTable
DROP TABLE "Auction";

-- DropTable
DROP TABLE "Bid";

-- DropTable
DROP TABLE "Item";

-- DropTable
DROP TABLE "ItemPhoto";

-- DropEnum
DROP TYPE "AuctionStatus";

-- DropEnum
DROP TYPE "Category";

-- CreateIndex
CREATE UNIQUE INDEX "User_refreshTokenHash_key" ON "User"("refreshTokenHash");
