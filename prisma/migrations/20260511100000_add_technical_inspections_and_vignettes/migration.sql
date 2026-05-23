-- CreateTable
CREATE TABLE "technical_inspections" (
    "id" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "technical_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vignettes" (
    "id" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "vignettes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "technical_inspections_registrationNumber_idx" ON "technical_inspections"("registrationNumber");

-- CreateIndex
CREATE INDEX "technical_inspections_validTo_idx" ON "technical_inspections"("validTo");

-- CreateIndex
CREATE INDEX "vignettes_registrationNumber_idx" ON "vignettes"("registrationNumber");

-- CreateIndex
CREATE INDEX "vignettes_validTo_idx" ON "vignettes"("validTo");

-- AddForeignKey
ALTER TABLE "technical_inspections" ADD CONSTRAINT "technical_inspections_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vignettes" ADD CONSTRAINT "vignettes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
