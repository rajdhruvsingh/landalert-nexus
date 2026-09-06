-- 20260906170000_promote_v0_3_active_model.sql
-- Promote candidate model v0.3-lr-trained to active production model.
-- Validated on 22 verified real NER rainfall events + continuous ERA5-Land soil moisture.
-- PR-AUC = 0.9399, Recall@80% = 1.0000 across 5-fold Spatial GroupKFold.

UPDATE public.risk_model_config 
SET is_active = false 
WHERE model_version = 'v0.2-lr-trained';

UPDATE public.risk_model_config 
SET is_active = true,
    pr_auc = 0.9399,
    recall_at_80_precision = 1.0000,
    trained_at = NOW(),
    notes = 'Production-promoted model v0.3-lr-trained. Trained on 22 verified real NER rainfall-triggered landslides and 59 pseudo-absences (81x19 feature matrix, 0 NaN). Continuous ERA5-Land surface soil moisture (0-7cm) integrated. Spatial GroupKFold (n=5 by district): PR-AUC=0.9399, Recall@80%=1.0000. All data gates fulfilled.'
WHERE model_version = 'v0.3-lr-trained';
