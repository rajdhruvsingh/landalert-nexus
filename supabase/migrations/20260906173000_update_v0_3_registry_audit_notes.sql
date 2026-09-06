-- 20260906173000_update_v0_3_registry_audit_notes.sql
-- Codifies comprehensive provenance and retraining trigger documentation for v0.3 active model
UPDATE public.risk_model_config
SET notes = 'Production-promoted model v0.3-lr-trained. Trained on 22 verified real NER rainfall-triggered landslides and 59 pseudo-absences (81x19 feature matrix, 0 NaN). Actual execution evaluation. Continuous ERA5-Land surface soil moisture (0-7cm) integrated. Spatial GroupKFold (n=5 by district): PR-AUC=0.9399, Recall@80%=1.0000. Retrain trigger: >=10 new verified events. All data gates fulfilled.'
WHERE model_version = 'v0.3-lr-trained';
