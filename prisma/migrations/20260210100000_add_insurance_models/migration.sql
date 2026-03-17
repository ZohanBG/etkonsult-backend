-- CreateTable
CREATE TABLE "insurance_spreadsheets" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_spreadsheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_policies" (
    "id" TEXT NOT NULL,
    "spreadsheetConfigId" TEXT NOT NULL,
    "sheetMonth" TEXT NOT NULL,
    "policyNumber" TEXT,
    "company" TEXT,
    "ownerName" TEXT,
    "registrationNumber" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "agent" TEXT,
    "amount" DECIMAL(65,30),
    "expiryDate" TIMESTAMP(3),
    "sticker" TEXT,
    "greenCard" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurance_policies_registrationNumber_idx" ON "insurance_policies"("registrationNumber");

-- CreateIndex
CREATE INDEX "insurance_policies_expiryDate_idx" ON "insurance_policies"("expiryDate");

-- CreateIndex
CREATE INDEX "insurance_policies_spreadsheetConfigId_idx" ON "insurance_policies"("spreadsheetConfigId");

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_spreadsheetConfigId_fkey" FOREIGN KEY ("spreadsheetConfigId") REFERENCES "insurance_spreadsheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
