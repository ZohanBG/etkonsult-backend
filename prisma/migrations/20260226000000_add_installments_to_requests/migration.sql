-- AlterTable
ALTER TABLE "requests" ADD COLUMN "installments" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
