-- Per-team switch for public links (mockup C11). Only matters while the organization policy allows them.
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS public_links boolean NOT NULL DEFAULT true;
