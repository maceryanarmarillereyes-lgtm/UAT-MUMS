-- Cleanup dirty support_catalog item codes created by the trailing-dash bug
-- Removes records with codes ending in '-' or containing '--' (e.g. CTR-001-, CTR-001--)
-- These were created when the Add Sub-Item button was clicked before a suffix was typed.
-- Safe to run multiple times (idempotent).

-- Step 1: Show what will be deleted (for audit — remove this in prod if not needed)
-- SELECT id, item_code, name, parent_id FROM support_catalog
-- WHERE item_code ~ '-$' OR item_code ~ '--';

-- Step 2: Delete cascades to support_catalog_comments and support_catalog_history
-- via ON DELETE CASCADE foreign keys set up in the original migration.

DELETE FROM support_catalog
WHERE item_code ~ '-$'        -- codes ending in dash:  CTR-001-
   OR item_code ~ '--';       -- codes with double dash: CTR-001--

-- Step 3: Add a CHECK constraint to prevent future dirty codes at DB level
ALTER TABLE support_catalog
  DROP CONSTRAINT IF EXISTS chk_item_code_no_trailing_dash;

ALTER TABLE support_catalog
  ADD CONSTRAINT chk_item_code_no_trailing_dash
  CHECK (
    item_code !~ '-$'   -- no trailing dash
    AND item_code !~ '--' -- no double dash
    AND length(trim(item_code)) > 0  -- not empty
  );
