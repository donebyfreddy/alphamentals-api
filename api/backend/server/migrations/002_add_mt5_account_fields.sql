-- Migration 002: Add MT5 account connection fields
-- Run this against your Supabase/Postgres database.
-- Uses IF NOT EXISTS so it is safe to run multiple times.

ALTER TABLE trading_accounts
  ADD COLUMN IF NOT EXISTS connection_mode   text              NOT NULL DEFAULT 'read_only',
  ADD COLUMN IF NOT EXISTS encrypted_password jsonb,
  ADD COLUMN IF NOT EXISTS vps_target        text,
  ADD COLUMN IF NOT EXISTS trading_enabled   boolean           NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_error_code   text,
  ADD COLUMN IF NOT EXISTS risk              jsonb             NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS diagnostics       jsonb             NOT NULL DEFAULT '{}';

-- Safe constraint addition: only add if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_accounts_connection_mode_check'
  ) THEN
    ALTER TABLE trading_accounts
      ADD CONSTRAINT trading_accounts_connection_mode_check
      CHECK (connection_mode IN ('read_only', 'trading'));
  END IF;
END $$;

-- Extend the status check to include new MT5 statuses (drop and recreate if exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_accounts_status_check'
  ) THEN
    ALTER TABLE trading_accounts DROP CONSTRAINT trading_accounts_status_check;
  END IF;
END $$;

-- No status constraint — status is free-text to allow extensibility.
-- Application layer validates allowed values.

-- Index for common query: list accounts by user
CREATE INDEX IF NOT EXISTS idx_trading_accounts_user_id ON trading_accounts (user_id);

-- Index for lookup by MT5 login + server (uniqueness check at app layer)
CREATE INDEX IF NOT EXISTS idx_trading_accounts_mt5_login_server
  ON trading_accounts (mt5_account_number, mt5_server)
  WHERE mt5_account_number IS NOT NULL;
