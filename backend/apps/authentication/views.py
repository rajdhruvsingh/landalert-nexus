import jwt
from datetime import datetime, timezone, timedelta
from django.conf import settings
from django.contrib.auth.hashers import make_password, check_password
from rest_framework.views import APIView

from apps.core.responses import api_response, api_error
from .models import UserProfile, AuditLog
from .domains import evaluate_email_domain
from .auth import authenticate_token, log_audit_event


def create_user_jwt(profile: UserProfile) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(profile.id),
        "id": str(profile.id),
        "email": profile.email,
        "user_metadata": {
            "full_name": profile.full_name,
            "institution": profile.institution,
            "department": profile.department,
            "designation": profile.designation,
            "role": profile.role,
            "dispatch_authorized": profile.dispatch_authorized,
        },
        "role": profile.role,
        "dispatch_authorized": profile.dispatch_authorized,
        "institution": profile.institution,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=7)).timestamp()),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def serialize_profile(profile: UserProfile) -> dict:
    return {
        "id": str(profile.id),
        "email": profile.email,
        "full_name": profile.full_name or "",
        "institution": profile.institution or "",
        "department": profile.department or "",
        "designation": profile.designation or "",
        "role": profile.role,
        "verification_status": profile.verification_status,
        "dispatch_authorized": profile.dispatch_authorized,
        "user_metadata": {
            "full_name": profile.full_name or "",
            "institution": profile.institution or "",
            "department": profile.department or "",
            "designation": profile.designation or "",
            "role": profile.role,
            "dispatch_authorized": profile.dispatch_authorized,
        },
    }


class LoginView(APIView):
    def post(self, request):
        data = request.data or {}
        email = str(data.get("email") or "").strip().lower()
        password = str(data.get("password") or "").strip()

        if not email or not password:
            return api_error("Email and password are required", "MISSING_CREDENTIALS", 400)

        profile = UserProfile.objects.filter(email=email).first()
        if not profile:
            return api_error("Invalid email or password", "INVALID_CREDENTIALS", 401)

        if not profile.password_hash or not check_password(password, profile.password_hash):
            return api_error("Invalid email or password", "INVALID_CREDENTIALS", 401)

        token = create_user_jwt(profile)

        log_audit_event(
            actor_user_id=str(profile.id),
            actor_role=profile.role,
            action="USER_LOGIN",
            target_type="user_profile",
            target_id=str(profile.id),
            result="SUCCESS",
            actor_email=profile.email,
            institution=profile.institution,
            details={"login_method": "password_native_postgres"},
        )

        return api_response({
            "ok": True,
            "token": token,
            "access_token": token,
            "user": serialize_profile(profile),
        })


class RegisterView(APIView):
    def post(self, request):
        data = request.data or {}
        email = str(data.get("email") or "").strip().lower()
        password = str(data.get("password") or "").strip()
        full_name = str(data.get("full_name") or data.get("fullName") or "").strip()
        institution = str(data.get("institution") or "").strip()
        department = str(data.get("department") or "").strip()
        designation = str(data.get("designation") or "").strip()

        if not email or "@" not in email:
            return api_error("A valid email address is required", "INVALID_EMAIL", 400)

        if len(password) < 8:
            return api_error("Password must be at least 8 characters long", "WEAK_PASSWORD", 400)

        if UserProfile.objects.filter(email=email).exists():
            return api_error("An account with this email already exists", "EMAIL_EXISTS", 409)

        # Domain evaluation
        domain_eval = evaluate_email_domain(email)
        is_official = domain_eval.get("is_institutional", False)

        if is_official:
            inst_info = domain_eval.get("institution_info", {})
            institution = institution or inst_info.get("institution_name", "Government Authority")
            role = "VERIFIED_OFFICIAL"
            verification_status = "PENDING_OFFICIAL_VERIFICATION"
        else:
            role = "PUBLIC_USER"
            verification_status = "UNVERIFIED"

        profile = UserProfile.objects.create(
            email=email,
            password_hash=make_password(password),
            full_name=full_name or email.split("@")[0],
            institution=institution,
            department=department,
            designation=designation,
            role=role,
            verification_status=verification_status,
            dispatch_authorized=False,
        )

        token = create_user_jwt(profile)

        log_audit_event(
            actor_user_id=str(profile.id),
            actor_role=profile.role,
            action="USER_REGISTER",
            target_type="user_profile",
            target_id=str(profile.id),
            result="SUCCESS",
            actor_email=profile.email,
            institution=profile.institution,
            details={"is_institutional": is_official, "initial_role": role},
        )

        return api_response({
            "ok": True,
            "token": token,
            "access_token": token,
            "user": serialize_profile(profile),
        }, status=201)


class MeView(APIView):
    def get(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION")
        user = authenticate_token(auth_header)
        if not user:
            return api_error("Not authenticated", "UNAUTHORIZED", 401)

        profile = UserProfile.objects.filter(id=user.id).first() if user.id != "unknown" else None
        if profile:
            user_data = serialize_profile(profile)
        else:
            user_data = {
                "id": user.id,
                "email": user.email,
                "role": user.role,
                "dispatch_authorized": user.dispatch_authorized,
                "institution": user.institution,
                "user_metadata": {
                    "role": user.role,
                    "dispatch_authorized": user.dispatch_authorized,
                    "institution": user.institution,
                },
            }

        return api_response({
            "authenticated": True,
            "user": user_data,
        })


class LogoutView(APIView):
    def post(self, request):
        return api_response({
            "ok": True,
            "message": "Logged out successfully",
        })

