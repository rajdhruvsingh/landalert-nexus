-- =============================================================
-- Migration: Reset unverified model metrics to NULL
-- =============================================================
-- RATIONALE:
--   The initial v0.2-lr-trained seed row in 20260904141000_task_g_trained_weights.sql
--   contained estimated PR-AUC (0.7140) and recall (0.6250) numbers that
--   were not produced by an end-to-end execution of the offline calibration
--   notebook.
--
--   Per project honesty policy: metrics in risk_model_config must reflect
--   actual verified training runs backed by docs/model_evaluation_results.csv.
--   Until the notebook produces verified numbers, these columns must be NULL.
-- =============================================================

UPDATE public.risk_model_config
SET pr_auc = NULL,
    recall_at_80_precision = NULL,
    notes = 'Weights are Task A/B/C-informed estimates; PR-AUC and recall pending actual notebook execution against real data.'
WHERE model_version = 'v0.2-lr-trained';
