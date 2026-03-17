-- CreateEnum: RequestType
CREATE TYPE "RequestType" AS ENUM ('NOVA_POLICA', 'VNOSKA');

-- Add requestType column with default (all existing requests become NOVA_POLICA)
ALTER TABLE "requests" ADD COLUMN "requestType" "RequestType" NOT NULL DEFAULT 'NOVA_POLICA';

-- Add insuranceNumber column for VNOSKA requests
ALTER TABLE "requests" ADD COLUMN "insuranceNumber" TEXT;

-- Make vehicle-specific fields nullable (VNOSKA doesn't use them)
ALTER TABLE "requests" ALTER COLUMN "talonNumber" DROP NOT NULL;
ALTER TABLE "requests" ALTER COLUMN "engineCapacity" DROP NOT NULL;
ALTER TABLE "requests" ALTER COLUMN "powerKW" DROP NOT NULL;

-- Index for filtering by requestType
CREATE INDEX "requests_requestType_idx" ON "requests"("requestType");
