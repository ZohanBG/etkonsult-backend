-- Change email_verifications from unique token (link-based) to userId+token compound unique (code-based)

-- Drop the old unique constraint and index on token
DROP INDEX IF EXISTS "email_verifications_token_key";
DROP INDEX IF EXISTS "email_verifications_token_idx";

-- Add compound unique index on (userId, token)
CREATE UNIQUE INDEX "email_verifications_userId_token_key" ON "email_verifications"("userId", "token");
