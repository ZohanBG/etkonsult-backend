-- Migration: Add RequestImageType and ResourceItemType enums
-- Also fix UserStatus default from PENDING to ACTIVE (matches application behaviour)

-- ── 1. Create RequestImageType enum ──────────────────────────────────────────

CREATE TYPE "RequestImageType" AS ENUM ('photo', 'offer', 'document');

-- Convert request_images.imageType from TEXT to the new enum.
-- All existing values are already one of 'photo', 'offer', 'document'.
ALTER TABLE "request_images"
  ALTER COLUMN "imageType" DROP DEFAULT;

ALTER TABLE "request_images"
  ALTER COLUMN "imageType" TYPE "RequestImageType"
  USING "imageType"::"RequestImageType";

ALTER TABLE "request_images"
  ALTER COLUMN "imageType" SET DEFAULT 'photo'::"RequestImageType";

-- ── 2. Create ResourceItemType enum ──────────────────────────────────────────

CREATE TYPE "ResourceItemType" AS ENUM ('file', 'link');

-- Convert resource_items.type from TEXT to the new enum.
-- All existing values are already one of 'file', 'link'.
ALTER TABLE "resource_items"
  ALTER COLUMN "type" TYPE "ResourceItemType"
  USING "type"::"ResourceItemType";

-- ── 3. Fix UserStatus default (PENDING → ACTIVE) ────────────────────────────

ALTER TABLE "users"
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"UserStatus";
