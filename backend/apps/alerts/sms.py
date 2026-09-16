import sys
from django.conf import settings
import requests

def dispatch_sms(recipients: list, message: str, template_id: str = None) -> dict:
    auth_key = getattr(settings, "MSG91_AUTH_KEY", "")
    if not auth_key:
        sys.stderr.write("[SMS Gateway] Discarding SMS dispatch: MSG91_AUTH_KEY is not set in environment.\n")
        sys.stderr.flush()
        return {"status": "discarded", "reason": "MSG91_AUTH_KEY_NOT_SET"}

    url = "https://control.msg91.com/api/v5/flow/"
    payload = {
        "template_id": template_id or getattr(settings, "MSG91_FLOW_ID", "default_flow"),
        "sender": getattr(settings, "MSG91_SENDER_ID", "LNDALR"),
        "recipients": recipients,
    }
    headers = {
        "authkey": auth_key,
        "content-type": "application/json",
    }
    try:
        res = requests.post(url, json=payload, headers=headers, timeout=5)
        return res.json()
    except Exception as e:
        return {"status": "error", "error": str(e)}
