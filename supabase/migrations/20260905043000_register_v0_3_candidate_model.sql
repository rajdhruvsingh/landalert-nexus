-- =============================================================
-- Migration: Register v0.3 candidate model in risk_model_config
-- =============================================================
-- PURPOSE:
--   Registers the retrained v0.3 model (N=15 verified landslide events)
--   in risk_model_config with status = 'validated' and is_active = false.
--   Per the model registry safety policy, this candidate model is NEVER
--   auto-promoted and requires deliberate manual activation by an administrator.
-- =============================================================

INSERT INTO public.risk_model_config (
  model_version,
  trained_at,
  weight_intensity,
  weight_antecedent,
  weight_soil_moisture,
  weight_slope,
  weight_history,
  cutoff_moderate,
  cutoff_high,
  cutoff_severe,
  pr_auc,
  recall_at_80_precision,
  positive_count,
  notes,
  is_active,
  status,
  artifact_path,
  feature_schema_version
) VALUES (
  'v0.3-lr-trained',
  '2026-09-04T21:58:03Z',
  0.3000,
  0.2200,
  0.2000,
  0.1600,
  0.1200,
  38.0,
  56.0,
  74.0,
  0.6363,
  0.0667,
  15,
  'Retrained Candidate Model v0.3: trained on 15 real NER landslide events. Validated via Spatial GroupKFold n=5 by district. Pending manual administrator activation.',
  false,
  'validated',
  'models/v0.3-lr-trained.json',
  'v1.0.0'
)
ON CONFLICT (model_version) DO UPDATE
SET status = 'validated',
    positive_count = 15,
    pr_auc = 0.6363,
    recall_at_80_precision = 0.0667,
    notes = EXCLUDED.notes,
    artifact_path = 'models/v0.3-lr-trained.json';
