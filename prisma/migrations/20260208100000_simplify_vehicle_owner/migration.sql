-- Simplify Vehicle and Owner models
-- Remove VIN, makeModel, color, seats, fuelType, registrationDate, loadCapacity, totalWeight, notes
-- Add purpose, rightHandDrive
-- Owner: merge egn/bulstat into identifier, make address required

-- DropIndex
DROP INDEX "owners_bulstat_key";
DROP INDEX "owners_egn_key";
DROP INDEX "vehicles_vin_idx";
DROP INDEX "vehicles_vin_key";

-- AlterTable owners
ALTER TABLE "owners" DROP COLUMN "bulstat",
DROP COLUMN "egn",
ADD COLUMN     "identifier" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "address" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "owners_identifier_key" ON "owners"("identifier");

-- AlterTable vehicles
ALTER TABLE "vehicles" DROP COLUMN "color",
DROP COLUMN "fuelType",
DROP COLUMN "loadCapacity",
DROP COLUMN "makeModel",
DROP COLUMN "notes",
DROP COLUMN "registrationDate",
DROP COLUMN "seats",
DROP COLUMN "totalWeight",
DROP COLUMN "vin",
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'Лични нужди',
ADD COLUMN     "rightHandDrive" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "talonNumber" SET NOT NULL,
ALTER COLUMN "engineCapacity" SET NOT NULL,
ALTER COLUMN "powerKW" SET NOT NULL;

-- AlterTable requests
ALTER TABLE "requests" DROP COLUMN "color",
DROP COLUMN "fuelType",
DROP COLUMN "loadCapacity",
DROP COLUMN "makeModel",
DROP COLUMN "notes",
DROP COLUMN "ownerBulstat",
DROP COLUMN "ownerEgn",
DROP COLUMN "registrationDate",
DROP COLUMN "seats",
DROP COLUMN "totalWeight",
DROP COLUMN "vin",
ADD COLUMN     "ownerIdentifier" TEXT,
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'Лични нужди',
ADD COLUMN     "rightHandDrive" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "talonNumber" SET NOT NULL,
ALTER COLUMN "engineCapacity" SET NOT NULL,
ALTER COLUMN "powerKW" SET NOT NULL;
