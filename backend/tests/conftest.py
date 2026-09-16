import pytest
from datetime import datetime, timezone
from django.db import connection
from django.apps import apps

@pytest.fixture(autouse=True, scope="session")
def setup_test_unmanaged_models(django_db_setup, django_db_blocker):
    """
    Ensure all unmanaged models (managed = False) are created in the test SQLite database schema.
    """
    unmanaged_models = [m for m in apps.get_models() if not m._meta.managed]
    for m in unmanaged_models:
        m._meta.managed = True

    with django_db_blocker.unblock():
        with connection.schema_editor() as editor:
            for m in unmanaged_models:
                try:
                    editor.create_model(m)
                except Exception:
                    pass

        from apps.gis.models import RiskZone
        from apps.risk.models import RiskModelConfig

        if RiskZone.objects.count() == 0:
            RiskZone.objects.create(
                id=1,
                zone_name="Tamenglong",
                district="Tamenglong",
                state="Manipur",
                centroid_lat=25.0,
                centroid_lng=93.5,
                mean_slope_deg=28.5,
                population=25000,
                threshold_e_mm=45.0,
                current_risk_level="Moderate",
                risk_score=47.5,
                threshold_i_coefficient=43.26,
                threshold_i_exponent=-0.78,
                threshold_source="Sikkim / NE-Himalaya: I = 43.26 * D^(-0.78)",
                soil_moisture_status="measured",
                last_computed_at=datetime.now(timezone.utc),
            )

        if RiskModelConfig.objects.count() == 0:
            RiskModelConfig.objects.create(
                id=1,
                model_version="v0.5-rf-xgb-ensemble",
                trained_at=datetime.now(timezone.utc),
                weight_intensity=0.35,
                weight_antecedent=0.25,
                weight_soil_moisture=0.20,
                weight_slope=0.10,
                weight_history=0.10,
                cutoff_moderate=38.0,
                cutoff_high=56.0,
                cutoff_severe=74.0,
                is_active=True,
                status="active",
                pr_auc=0.7696,
                recall_at_80_precision=0.9548,
                artifact_path="models/v0.5-rf-xgb-ensemble.json",
                notes="Trained on GeoDataIndia NER dataset with 2:1 pseudo-absence ratio",
            )
