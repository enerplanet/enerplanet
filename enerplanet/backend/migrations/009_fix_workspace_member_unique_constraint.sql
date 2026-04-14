-- Migration: Fix workspace member unique constraint
-- Created: 2025-10-17
-- Description: Change unique constraint from (workspace_id, user_id) to (workspace_id, email)
--              This allows invitation system to work properly with empty user_id for pending invitations.

BEGIN;

-- Drop the old unique constraint on (workspace_id, user_id)
DROP INDEX IF EXISTS uq_workspace_member_user;

-- Create a new unique constraint on (workspace_id, email)
-- This ensures a user can only be invited once per workspace, regardless of registration status
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_member_email
  ON workspace_members(workspace_id, email);

-- Optional: Create a partial unique index to still prevent duplicate registered users in the same workspace
-- This index only applies when user_id is not empty
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_member_registered_user
  ON workspace_members(workspace_id, user_id)
  WHERE user_id != '';

COMMENT ON INDEX uq_workspace_member_email IS 'Ensures each email can only be a member of a workspace once';
COMMENT ON INDEX uq_workspace_member_registered_user IS 'Prevents duplicate registered users in the same workspace';

COMMIT;
