-- AlterTable
ALTER TABLE "vehicle_images" ADD COLUMN "rotation" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "request_images" ADD COLUMN "rotation" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "client_documents" ADD COLUMN "rotation" INTEGER NOT NULL DEFAULT 0;
