-- CreateTable resource_sections
CREATE TABLE "resource_sections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "resource_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable resource_items
CREATE TABLE "resource_items" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "filePath" TEXT,
    "originalName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "resource_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resource_items_sectionId_idx" ON "resource_items"("sectionId");

-- AddForeignKey
ALTER TABLE "resource_items" ADD CONSTRAINT "resource_items_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "resource_sections"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
