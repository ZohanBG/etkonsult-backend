-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('ZAYAVEN', 'OBRABOTEN', 'OTKAZAN', 'OFERTA', 'PRIETA_OFERTA', 'OTKAZANA_OFERTA', 'ZAVURSHENA');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "username" TEXT;

-- CreateTable
CREATE TABLE "requests" (
    "id" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'ZAYAVEN',
    "registrationNumber" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "makeModel" TEXT NOT NULL,
    "talonNumber" TEXT,
    "color" TEXT,
    "seats" TEXT,
    "engineCapacity" TEXT,
    "powerKW" TEXT,
    "fuelType" TEXT,
    "registrationDate" TEXT,
    "loadCapacity" TEXT,
    "totalWeight" TEXT,
    "notes" TEXT,
    "ownerName" TEXT,
    "ownerEgn" TEXT,
    "ownerBulstat" TEXT,
    "ownerAddress" TEXT,
    "ownerPhone" TEXT,
    "ownerEmail" TEXT,
    "stickerNumber" TEXT,
    "greenCardNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "agentId" TEXT NOT NULL,
    "processedById" TEXT,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_images" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "imageType" TEXT NOT NULL DEFAULT 'photo',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "requests_agentId_idx" ON "requests"("agentId");

-- CreateIndex
CREATE INDEX "requests_status_idx" ON "requests"("status");

-- CreateIndex
CREATE INDEX "requests_processedById_idx" ON "requests"("processedById");

-- CreateIndex
CREATE INDEX "request_images_requestId_idx" ON "request_images"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_images" ADD CONSTRAINT "request_images_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
