import time
from rest_framework.throttling import BaseThrottle
from rest_framework.exceptions import Throttled

class InMemoryRateLimiter:
    def __init__(self):
        self._buckets = {}

    def check_limit(self, key: str, max_requests: int, window_seconds: int):
        now = time.time()
        entry = self._buckets.get(key)

        if not entry or now >= entry["reset_at"]:
            reset_at = now + window_seconds
            self._buckets[key] = {"count": 1, "reset_at": reset_at}
            return {
                "allowed": True,
                "limit": max_requests,
                "remaining": max_requests - 1,
                "reset_seconds": window_seconds,
            }

        if entry["count"] < max_requests:
            entry["count"] += 1
            reset_seconds = max(1, int(entry["reset_at"] - now))
            return {
                "allowed": True,
                "limit": max_requests,
                "remaining": max_requests - entry["count"],
                "reset_seconds": reset_seconds,
            }

        reset_seconds = max(1, int(entry["reset_at"] - now))
        return {
            "allowed": False,
            "limit": max_requests,
            "remaining": 0,
            "reset_seconds": reset_seconds,
        }

    def reset(self, key: str):
        self._buckets.pop(key, None)

    def clear(self):
        self._buckets.clear()

default_limiter = InMemoryRateLimiter()

def get_client_ip(request):
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "127.0.0.1")

def get_client_identifier(request, prefix=""):
    auth_header = request.META.get("HTTP_AUTHORIZATION", "")
    ip = get_client_ip(request)
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        # Use last 16 chars of token if present
        ident = f"user:{token[-16:]}" if len(token) >= 16 else f"user:{token}"
    else:
        ident = f"ip:{ip}"
    return f"{prefix}:{ident}" if prefix else ident

class PolicyThrottle(BaseThrottle):
    prefix = ""
    max_requests = 100
    window_seconds = 60

    def allow_request(self, request, view):
        ident = get_client_identifier(request, self.prefix)
        res = default_limiter.check_limit(ident, self.max_requests, self.window_seconds)
        self.reset_seconds = res["reset_seconds"]
        self.remaining = res["remaining"]
        self.limit = res["limit"]
        if not res["allowed"]:
            return False
        return True

    def wait(self):
        return getattr(self, "reset_seconds", 60)

class AlertDispatchThrottle(PolicyThrottle):
    prefix = "alert_dispatch"
    max_requests = 5
    window_seconds = 60

class MediaUploadThrottle(PolicyThrottle):
    prefix = "media_upload"
    max_requests = 20
    window_seconds = 60

class ObservationSyncThrottle(PolicyThrottle):
    prefix = "observation_sync"
    max_requests = 30
    window_seconds = 60
