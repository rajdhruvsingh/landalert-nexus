from datetime import datetime, timezone
from rest_framework.response import Response

def api_response(data=None, status=200, headers=None):
    """Returns standardized JSON response with no-store cache control."""
    hdrs = {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    }
    if headers:
        hdrs.update(headers)
    return Response(data, status=status, headers=hdrs)

def api_error(message: str, code: str = "BAD_REQUEST", status: int = 400, headers: dict = None):
    """
    Standard error response matching Node.js errorResponse:
    {
      "error": "...",
      "code": "...",
      "status": 400,
      "timestamp": "..."
    }
    """
    payload = {
        "error": message,
        "code": code,
        "status": status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return api_response(payload, status=status, headers=headers)
