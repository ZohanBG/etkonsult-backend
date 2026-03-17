-- Add agentNote field to Request model
-- Stores a note from the agent when accepting an offer (PRIETA_OFERTA)

ALTER TABLE "requests" ADD COLUMN "agentNote" TEXT;
