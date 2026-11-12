-- CreateEnum
CREATE TYPE "UniverseAudience" AS ENUM ('GENERAL', 'YOUTH', 'UNREVIEWED');

-- AlterTable
ALTER TABLE "Universe" ADD COLUMN     "audience" "UniverseAudience" NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN     "audienceNote" TEXT,
ADD COLUMN     "audienceSetAt" TIMESTAMP(3),
ADD COLUMN     "audienceSetById" TEXT;

-- AddForeignKey
ALTER TABLE "Universe" ADD CONSTRAINT "Universe_audienceSetById_fkey" FOREIGN KEY ("audienceSetById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: deny by default.
-- Universes that existed before the classification were never reviewed under it. They start
-- as UNREVIEWED (the column default), their sensitive modes are switched off ('historic' is
-- the only sensitive mode at this point) and any earlier unlock is cleared, so that reviewing
-- a universe later never silently re-activates a mode: it has to be enabled again on purpose.
UPDATE "Universe"
SET "enabledModes" = array_remove("enabledModes", 'historic'),
    "sensitiveUnlockedAt" = NULL,
    "sensitiveUnlockNote" = NULL,
    "sensitiveUnlockedById" = NULL;
