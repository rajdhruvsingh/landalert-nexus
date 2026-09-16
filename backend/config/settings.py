"""
backend/config/settings.py
==========================
Django settings for LandAlert-Nexus Backend.
Converts Node.js REST API layer to Django + Django REST Framework (DRF)
with full feature parity, native Python ML inference, and Supabase PostgreSQL support.
"""

import os
import sys
from pathlib import Path
import dj_database_url
from dotenv import load_dotenv

# Build paths inside the project
BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

# Ensure both backend and repo root are on PYTHONPATH
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Load .env from repo root
load_dotenv(REPO_ROOT / ".env")

# Security
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY") or os.getenv("SECRET_KEY") or "django-insecure-landalert-nexus-production-key-2026"
DEBUG = os.getenv("DJANGO_DEBUG", "False").lower() in ("true", "1", "yes")

ALLOWED_HOSTS = ["*"]

# Application definition
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    # Third-party apps
    "rest_framework",
    "corsheaders",
    # Local apps
    "apps.core",
    "apps.authentication",
    "apps.risk",
    "apps.alerts",
    "apps.observations",
    "apps.gis",
    "apps.satellite",
    "apps.integrations",
    "apps.monitoring",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [REPO_ROOT / "dist"] if (REPO_ROOT / "dist").exists() else [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Database
# Use sqlite in-memory for automated tests (pytest / manage.py test)
IS_TESTING = "pytest" in sys.modules or (len(sys.argv) > 1 and sys.argv[1] == "test")
DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()

if IS_TESTING:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": ":memory:",
        }
    }
elif DATABASE_URL:
    DATABASES = {
        "default": dj_database_url.config(
            default=DATABASE_URL,
            conn_max_age=600,
            ssl_require=True if "supabase.com" in DATABASE_URL or "sslmode=require" in DATABASE_URL else False,
        )
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

# Internationalization
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = "/static/"
STATIC_ROOT = REPO_ROOT / "staticfiles"

DIST_DIR = REPO_ROOT / ".output" / "public" if (REPO_ROOT / ".output" / "public").exists() else (REPO_ROOT / "dist")
STATICFILES_DIRS = [DIST_DIR] if DIST_DIR.exists() else []

# Whitenoise: Serve SPA frontend if built
WHITENOISE_INDEX_FILE = True
if DIST_DIR.exists():
    WHITENOISE_ROOT = DIST_DIR

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# CORS configuration
CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    "x-client-version",
    "x-system-cron-secret",
]
CORS_ALLOW_METHODS = [
    "DELETE",
    "GET",
    "OPTIONS",
    "PATCH",
    "POST",
    "PUT",
]

# Django REST Framework configuration
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ],
    "EXCEPTION_HANDLER": "apps.core.exceptions.custom_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "300/minute",
        "user": "1000/minute",
        "sms_dispatch": "10/minute",
        "media_upload": "30/minute",
        "observation_sync": "60/minute",
    },
}

# Third-party integration configurations
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY", "")
SYSTEM_CRON_SECRET = os.getenv("SYSTEM_CRON_SECRET", "test-cron-secret-12345")
MSG91_AUTH_KEY = os.getenv("MSG91_AUTH_KEY", "")
MSG91_SENDER_ID = os.getenv("MSG91_SENDER_ID", "LNDALR")
MSG91_FLOW_ID = os.getenv("MSG91_FLOW_ID", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
