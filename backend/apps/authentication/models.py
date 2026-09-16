import uuid
from django.db import models

class UserProfile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    email = models.CharField(max_length=255, unique=True)
    full_name = models.TextField(null=True, blank=True)
    institution = models.TextField(null=True, blank=True)
    department = models.TextField(null=True, blank=True)
    designation = models.TextField(null=True, blank=True)
    role = models.CharField(max_length=64, default="PUBLIC_USER")
    verification_status = models.CharField(max_length=64, default="UNVERIFIED")
    dispatch_authorized = models.BooleanField(default=False)
    verified_by = models.TextField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "user_profiles"

    def __str__(self):
        return f"{self.email} ({self.role})"

class AuditLog(models.Model):
    id = models.BigAutoField(primary_key=True)
    actor_user_id = models.TextField()
    actor_email = models.TextField(null=True, blank=True)
    actor_role = models.CharField(max_length=64)
    institution = models.TextField(null=True, blank=True)
    action = models.CharField(max_length=128)
    target_type = models.CharField(max_length=64)
    target_id = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    result = models.CharField(max_length=32)
    details = models.JSONField(default=dict)
    reason = models.TextField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = "audit_logs"

    def __str__(self):
        return f"[{self.timestamp}] {self.actor_email} -> {self.action} ({self.result})"
