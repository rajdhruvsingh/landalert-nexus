from django.db import models

class Alert(models.Model):
    id = models.BigAutoField(primary_key=True)
    zone_id = models.IntegerField()
    risk_level = models.TextField()
    message = models.TextField()
    language = models.TextField()
    channel = models.TextField()
    explanation = models.TextField()
    dispatched_at = models.DateTimeField(auto_now_add=True)
    dispatched_by = models.TextField()
    status = models.TextField(default="sent")
    recipient_group = models.TextField(default="all_residents")
    idempotency_key = models.TextField(null=True, blank=True)
    delivery_attempts = models.IntegerField(default=1)
    last_error = models.TextField(null=True, blank=True)
    authorizing_official_id = models.TextField(null=True, blank=True)
    authorizing_official_role = models.TextField(null=True, blank=True)
    authorizing_institution = models.TextField(null=True, blank=True)
    dispatch_status = models.TextField(default="dispatched")
    justification = models.TextField(null=True, blank=True)
    provider_message_id = models.TextField(null=True, blank=True)
    provider_response = models.JSONField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = "alerts"
        ordering = ["-dispatched_at"]

    def __str__(self):
        return f"Alert {self.id} for Zone {self.zone_id} [{self.status}]"
