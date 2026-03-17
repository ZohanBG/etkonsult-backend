-- CreateTable
CREATE TABLE "agent_mappings" (
    "id" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_mappings_agentName_key" ON "agent_mappings"("agentName");

-- CreateIndex
CREATE INDEX "agent_mappings_userId_idx" ON "agent_mappings"("userId");

-- AddForeignKey
ALTER TABLE "agent_mappings" ADD CONSTRAINT "agent_mappings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
