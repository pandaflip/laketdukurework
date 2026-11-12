-- CreateEnum
CREATE TYPE "CharacterStatus" AS ENUM ('ALLOWED', 'RESTRICTED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "AgeClass" AS ENUM ('UNKNOWN', 'ADULT_VERIFIED', 'MINOR', 'CHILDLIKE', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "LabelKind" AS ENUM ('NAME', 'ALIAS');

-- CreateEnum
CREATE TYPE "AssetReview" AS ENUM ('UNVERIFIED', 'APPROVED_NEUTRAL', 'APPROVED_SENSITIVE', 'REJECTED');

-- CreateTable
CREATE TABLE "Universe" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabledModes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Universe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "universeId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "CharacterStatus" NOT NULL DEFAULT 'RESTRICTED',
    "ageClass" "AgeClass" NOT NULL DEFAULT 'UNKNOWN',
    "ageClassNote" TEXT,
    "ageClassSetAt" TIMESTAMP(3),
    "ageClassSetById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterLabel" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "kind" "LabelKind" NOT NULL,
    "value" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,

    CONSTRAINT "CharacterLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterBlockedMode" (
    "characterId" TEXT NOT NULL,
    "modeId" TEXT NOT NULL,

    CONSTRAINT "CharacterBlockedMode_pkey" PRIMARY KEY ("characterId","modeId")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "names" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "review" "AssetReview" NOT NULL DEFAULT 'UNVERIFIED',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "batchId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "revertsId" TEXT,
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Universe_slug_key" ON "Universe"("slug");

-- CreateIndex
CREATE INDEX "Character_status_idx" ON "Character"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Character_universeId_slug_key" ON "Character"("universeId", "slug");

-- CreateIndex
CREATE INDEX "CharacterLabel_normalized_idx" ON "CharacterLabel"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterLabel_characterId_locale_normalized_key" ON "CharacterLabel"("characterId", "locale", "normalized");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_characterId_slug_key" ON "Variant"("characterId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_batchId_idx" ON "AuditLog"("batchId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_ageClassSetById_fkey" FOREIGN KEY ("ageClassSetById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterLabel" ADD CONSTRAINT "CharacterLabel_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterBlockedMode" ADD CONSTRAINT "CharacterBlockedMode_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
