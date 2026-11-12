-- Images and sequences (lot 1C).
--
-- "Asset" becomes the image of a character: it gets a direct owner, the file
-- information and timestamps, and its skin link becomes optional. In the previous
-- lot an Asset was only a review placeholder without any file and could only be
-- created by tests, so those rows cannot be kept: they have no file to point to.
DELETE FROM "Asset";
-- DropForeignKey
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_variantId_fkey";

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "bytes" INTEGER NOT NULL,
ADD COLUMN     "characterId" TEXT NOT NULL,
ADD COLUMN     "height" INTEGER NOT NULL,
ADD COLUMN     "label" TEXT NOT NULL,
ADD COLUMN     "sha256" TEXT NOT NULL,
ADD COLUMN     "sourceFormat" TEXT NOT NULL,
ADD COLUMN     "storageKey" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "width" INTEGER NOT NULL,
ALTER COLUMN "variantId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "modeId" TEXT NOT NULL,
    "aspectW" INTEGER NOT NULL,
    "aspectH" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "w" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sequence_assetId_idx" ON "Sequence"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_sequenceId_position_key" ON "SequenceStep"("sequenceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_storageKey_key" ON "Asset"("storageKey");

-- CreateIndex
CREATE INDEX "Asset_characterId_createdAt_idx" ON "Asset"("characterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_characterId_sha256_key" ON "Asset"("characterId", "sha256");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

