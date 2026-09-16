import os
from pathlib import Path
from django.http import HttpResponse, Http404
from django.conf import settings

def spa_index_view(request):
    """
    Serves the SPA frontend index.html if built, else returns a friendly API status page.
    """
    index_path = getattr(settings, "DIST_DIR", settings.REPO_ROOT / "dist") / "index.html"
    if index_path.exists():
        with open(index_path, "r", encoding="utf-8") as f:
            return HttpResponse(f.read(), content_type="text/html")
    return HttpResponse(
        """<!DOCTYPE html>
<html>
<head><title>LandAlert-Nexus API</title></head>
<body style="font-family:system-ui,sans-serif;padding:40px;background:#0b132b;color:#e0e1dd;">
  <h2>LandAlert-Nexus Production API (Django/DRF)</h2>
  <p>Operational endpoints available under <code>/api/*</code>.</p>
  <ul>
    <li><a style="color:#48cae4;" href="/api/health">/api/health</a></li>
    <li><a style="color:#48cae4;" href="/api/ml/health">/api/ml/health</a></li>
    <li><a style="color:#48cae4;" href="/api/risk-prediction">/api/risk-prediction</a></li>
    <li><a style="color:#48cae4;" href="/api/gis/zones.geojson">/api/gis/zones.geojson</a></li>
  </ul>
</body>
</html>""",
        content_type="text/html",
    )

def api_404_view(request, unmatched_path=""):
    """
    Standardized JSON error envelope for non-existent /api/* routes.
    """
    from django.http import JsonResponse
    from datetime import datetime, timezone

    payload = {
        "error": f"Endpoint not found: {request.path}",
        "code": "NOT_FOUND",
        "status": 404,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return JsonResponse(payload, status=404)
