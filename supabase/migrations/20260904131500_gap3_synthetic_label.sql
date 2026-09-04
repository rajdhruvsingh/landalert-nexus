-- =============================================================
-- GAP 3: Fix misleading source label on synthetic historical data
-- =============================================================
-- PROBLEM: historical_landslides rows were generated via modulo
-- arithmetic on zone/loop indices.  The source column said
-- 'GSI Bhukosh (fixture)' — overstating authenticity even though
-- 'fixture' was present.  No teammate or judge should mistake this
-- for a real GSI Bhukosh export.
--
-- FIX:
--   1. Add is_synthetic BOOLEAN NOT NULL DEFAULT true column.
--   2. Update all existing rows to a clearly synthetic label.
--
-- If real NE-Himalaya inventory data (GSI Bhukosh export or the
-- ~490-event catalogue from Mathew et al. 2014) becomes available
-- before the deadline, write a SEPARATE migration that:
--   a) Inserts the real events with is_synthetic = false and
--      source = 'GSI Bhukosh export <date>' (or the paper citation).
--   b) Optionally deletes or retains the synthetic rows depending
--      on whether you still want illustrative fixtures.
--   See docs/DATA_SOURCES.md for where to obtain that data.
-- =============================================================

-- Step 1: Add the is_synthetic column
ALTER TABLE public.historical_landslides
  ADD COLUMN IF NOT EXISTS is_synthetic BOOLEAN NOT NULL DEFAULT true;

-- Step 2: Relabel all existing rows to be unambiguously synthetic
UPDATE public.historical_landslides
SET source       = 'Synthetic fixture — illustrative only, not sourced from GSI Bhukosh',
    is_synthetic = true
WHERE is_synthetic = true
   OR source LIKE '%fixture%'
   OR source LIKE '%GSI%';
