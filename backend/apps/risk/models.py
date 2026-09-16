from django.db import models

class RiskModelConfig(models.Model):
    id = models.IntegerField(primary_key=True)
    model_version = models.TextField(unique=True)
    trained_at = models.DateTimeField()
    weight_intensity = models.FloatField()
    weight_antecedent = models.FloatField()
    weight_soil_moisture = models.FloatField()
    weight_slope = models.FloatField()
    weight_history = models.FloatField()
    cutoff_moderate = models.FloatField()
    cutoff_high = models.FloatField()
    cutoff_severe = models.FloatField()
    pr_auc = models.FloatField(null=True, blank=True)
    recall_at_80_precision = models.FloatField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=False)
    dataset_fingerprint = models.TextField(null=True, blank=True)
    status = models.TextField()
    artifact_path = models.TextField(null=True, blank=True)
    feature_schema_version = models.TextField(null=True, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)
    retired_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = "risk_model_config"

    def __str__(self):
        return f"{self.model_version} (active={self.is_active})"

class RiskModelActivationLog(models.Model):
    id = models.IntegerField(primary_key=True)
    model_version = models.TextField()
    action = models.TextField()
    previous_active_version = models.TextField(null=True, blank=True)
    actor = models.TextField()
    reason = models.TextField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "risk_model_activation_log"

class RiskPrediction(models.Model):
    id = models.BigAutoField(primary_key=True)
    zone_id = models.IntegerField()
    prediction_time = models.DateTimeField()
    model_version = models.TextField()
    feature_schema_version = models.TextField()
    probability = models.FloatField()
    risk_score = models.FloatField()
    risk_category = models.TextField()
    explanation = models.TextField()
    data_quality = models.JSONField()
    features = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "risk_predictions"
