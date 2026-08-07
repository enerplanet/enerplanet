-- Migration: Add model_intro_card_dismissed to user_settings
-- Created: 2026-08-03
-- Description: The UserSetting model has carried ModelIntroCardDismissed since the
-- common models package was extracted, but no migration ever created the column.
-- Reads still worked, while every INSERT/UPDATE issued by GORM failed — breaking
-- first-time user provisioning (GetOrCreateUserSettings) and all settings writes.

BEGIN;

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS model_intro_card_dismissed BOOLEAN DEFAULT FALSE;

COMMIT;
