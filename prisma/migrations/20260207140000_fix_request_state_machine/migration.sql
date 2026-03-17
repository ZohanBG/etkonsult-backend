-- Rename enum values to feminine form (заявка is feminine in Bulgarian)
-- and remove OFERTA status (merged into OBRABOTENA)

-- Step 1: Rename existing values
ALTER TYPE "RequestStatus" RENAME VALUE 'ZAYAVEN' TO 'ZAYAVENA';
ALTER TYPE "RequestStatus" RENAME VALUE 'OBRABOTEN' TO 'OBRABOTENA';
ALTER TYPE "RequestStatus" RENAME VALUE 'OTKAZAN' TO 'OTKAZANA';

-- Step 2: Migrate any existing OFERTA records to OBRABOTENA
UPDATE "requests" SET "status" = 'OBRABOTENA' WHERE "status" = 'OFERTA';

-- Step 3: Remove the OFERTA enum value
-- PostgreSQL doesn't support DROP VALUE directly, so we recreate the type

-- Drop the default first (cannot cast default automatically)
ALTER TABLE "requests" ALTER COLUMN "status" DROP DEFAULT;

-- Create a new type without OFERTA
CREATE TYPE "RequestStatus_new" AS ENUM ('ZAYAVENA', 'OBRABOTENA', 'OTKAZANA', 'PRIETA_OFERTA', 'OTKAZANA_OFERTA', 'ZAVURSHENA');

-- Alter the column to use the new type
ALTER TABLE "requests" ALTER COLUMN "status" TYPE "RequestStatus_new" USING ("status"::text::"RequestStatus_new");

-- Drop the old type and rename
DROP TYPE "RequestStatus";
ALTER TYPE "RequestStatus_new" RENAME TO "RequestStatus";

-- Restore the default with the new type
ALTER TABLE "requests" ALTER COLUMN "status" SET DEFAULT 'ZAYAVENA'::"RequestStatus";
