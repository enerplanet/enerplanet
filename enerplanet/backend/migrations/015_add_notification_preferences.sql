-- Migration: Add notification preferences to user_settings
-- Created: 2025-11-14
-- Description: Add fields for email and browser notification preferences

BEGIN;

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS browser_notifications BOOLEAN DEFAULT TRUE;

COMMIT;
