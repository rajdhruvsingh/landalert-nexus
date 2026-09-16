from datetime import datetime, timezone
from rest_framework.views import exception_handler
from rest_framework.exceptions import Throttled, AuthenticationFailed, NotAuthenticated, PermissionDenied, NotFound
from rest_framework.response import Response

def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if response is not None:
        headers = dict(response.headers) if hasattr(response, "headers") else {}
        status_code = response.status_code
        code = "BAD_REQUEST"
        message = "An error occurred"

        if isinstance(exc, Throttled):
            code = "RATE_LIMIT_EXCEEDED"
            wait = getattr(exc, "wait", 60)
            headers["Retry-After"] = str(int(wait) if wait else 60)
            message = f"Rate limit exceeded. Try again in {int(wait) if wait else 60} seconds."
        elif isinstance(exc, (NotAuthenticated, AuthenticationFailed)):
            code = "UNAUTHORIZED"
            message = str(exc.detail) if hasattr(exc, "detail") else "Authentication required"
        elif isinstance(exc, PermissionDenied):
            code = "FORBIDDEN"
            message = str(exc.detail) if hasattr(exc, "detail") else "Permission denied"
        elif isinstance(exc, NotFound):
            code = "NOT_FOUND"
            message = str(exc.detail) if hasattr(exc, "detail") else "Resource not found"
        else:
            if isinstance(response.data, dict):
                message = response.data.get("detail") or response.data.get("error") or str(response.data)
            elif isinstance(response.data, list):
                message = ", ".join(str(d) for d in response.data)
            else:
                message = str(response.data)

        payload = {
            "error": str(message),
            "code": code,
            "status": status_code,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        return Response(payload, status=status_code, headers=headers)

    # Unhandled 500
    import traceback
    traceback.print_exc()
    payload = {
        "error": f"An unexpected server error occurred: {exc}",
        "code": "INTERNAL_SERVER_ERROR",
        "status": 500,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return Response(payload, status=500)
