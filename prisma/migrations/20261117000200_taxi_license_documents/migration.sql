-- Driver onboarding: taxi licence (required by Cabinet of Ministers Resolution No. 200 of 2 April 2025)
-- and self-employment registration certificate. Legal requirements must be confirmed by counsel.
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'TAXI_LICENSE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'SELF_EMPLOYED_CERT';
