-- AlterTable
ALTER TABLE "Universe" ADD COLUMN     "sensitiveUnlockNote" TEXT,
ADD COLUMN     "sensitiveUnlockedAt" TIMESTAMP(3),
ADD COLUMN     "sensitiveUnlockedById" TEXT;

-- AddForeignKey
ALTER TABLE "Universe" ADD CONSTRAINT "Universe_sensitiveUnlockedById_fkey" FOREIGN KEY ("sensitiveUnlockedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
