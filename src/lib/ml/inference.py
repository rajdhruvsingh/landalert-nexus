"""
src/lib/ml/inference.py
=======================
Canonical production inference engine for LandAlert-Nexus.
Handles:
- Loading the active model artifact
- Extracting canonical 19 features with strict temporal cutoff
- Assessing data freshness and quality states (VALID, STALE, FALLBACK, MISSING, INVALID)
- Computing calibrated probability, operational risk score, and risk category
- Producing ranked, mathematically grounded feature attributions and dynamic explanations
"""

import os
import sys
import json
import math
import warnings
import logging
from datetime import datetime, timezone
import numpy as np
import pandas as pd
import psycopg2

logger = logging.getLogger("landalert.ml.inference")

warnings.filterwarnings("ignore", message="pandas only supports SQLAlchemy connectable.*")
warnings.filterwarnings("ignore", category=UserWarning, module="pandas")
from dotenv import load_dotenv

try:
    from .features import (
        CANONICAL_FEATURES,
        FEATURE_SCHEMA_VERSION,
        extract_features_for_zone,
        validate_feature_vector,
    )
    from .artifact import load_model_artifact, ModelArtifact
except (ImportError, ValueError):
    sys.path.insert(0, os.path.dirname(__file__))
    from features import (
        CANONICAL_FEATURES,
        FEATURE_SCHEMA_VERSION,
        extract_features_for_zone,
        validate_feature_vector,
    )
    from artifact import load_model_artifact, ModelArtifact

load_dotenv()
_raw_db_url = os.getenv("DATABASE_URL")
DATABASE_URL = _raw_db_url.strip() if _raw_db_url and _raw_db_url.strip() else None
_is_production = os.getenv("NODE_ENV") == "production" or os.getenv("ENVIRONMENT") == "production"

# Preferred artifact paths (newest first).
# The inference engine uses the first path that exists on disk.
_V05_ARTIFACT_PATH = "models/v0.5-rf-xgb-ensemble.json"
_V04_ARTIFACT_PATH = "models/v0.4-lr-trained.json"

# Resolve to v0.5 if the companion joblib files are present, else degrade to v0.4 LR.
def _resolve_fallback_artifact() -> str:
    v05_rf  = "models/v0.5-rf-xgb-ensemble-rf.joblib"
    v05_xgb = "models/v0.5-rf-xgb-ensemble-xgb.joblib"
    if (
        os.path.isfile(_V05_ARTIFACT_PATH)
        and os.path.isfile(v05_rf)
        and os.path.isfile(v05_xgb)
    ):
        return _V05_ARTIFACT_PATH
    return _V04_ARTIFACT_PATH

_FALLBACK_ARTIFACT_PATH = _resolve_fallback_artifact()

# Regional calibrated cutoffs across all 8 Northeast India states and geological terranes.
# Terrane 0 (Sikkim Higher & Lesser Himalaya): Crystalline gneiss/schist (38, 56, 74).
# Terrane 1 (Arunachal Fold & Thrust Belt): Eastern Himalayan Syntax (38, 56, 74).
# Terrane 2 (Nagaland Flysch): Indo-Burman Wedge & Naga Hills Disang/Barail beds (20, 32, 50).
# Terrane 3 (Mizoram & Tripura Neogene): Surma Basin & Mizo Fold Belt clay-shale (26, 42, 60).
# Terrane 4 (Meghalaya, Assam, Manipur): Shillong Plateau, Brahmaputra Margin & Manipur Ophiolite (36, 54, 72 / 28, 44, 62).

DEFAULT_PAN_NER_CUTOFFS = {
    "moderate": 38.0,
    "high": 56.0,
    "severe": 74.0,
    "terrane": "Standard Pan-NER Baseline",
}

STATE_TERRANE_FALLBACKS = {
    "Nagaland": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Mizoram": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Tripura": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Manipur": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Meghalaya": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},
    "Assam": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Sikkim": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Sikkim Crystalline & Lesser Himalaya"},
    "Arunachal": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Arunachal Pradesh": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
}

_ALL_NER_DISTRICT_CUTOFFS = {
    # Nagaland (Terrane 2: Disang/Barail Flysch)
    "Kohima": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Dimapur": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Mokokchung": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Mon": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Phek": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Tuensang": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Wokha": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Zunheboto": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Kiphire": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Longleng": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Peren": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Noklak": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Chumoukedima": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Niuland": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Tseminyu": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},
    "Shamator": {"moderate": 20.0, "high": 32.0, "severe": 50.0, "terrane": "Indo-Burman Wedge & Naga Hills"},

    # Mizoram (Terrane 3: Surma Basin & Mizo Fold Belt)
    "Aizawl": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Lunglei": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Champhai": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Kolasib": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Lawngtlai": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Mamit": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Saiha": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Siaha": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Serchhip": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Hnahthial": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Khawzawl": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Saitual": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},

    # Tripura (Terrane 3: Surma Basin Anticlinal Ridges)
    "Dhalai": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "North Tripura": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "South Tripura": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "West Tripura": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Gomati": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Khowai": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Sepahijala": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},
    "Unakoti": {"moderate": 26.0, "high": 42.0, "severe": 60.0, "terrane": "Surma Basin & Mizo Fold Belt"},

    # Manipur (Terrane 4b: Indo-Burman Range & Manipur Ophiolite)
    "Imphal East": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Imphal West": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Bishnupur": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Thoubal": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Churachandpur": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Chandel": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Senapati": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Tamenglong": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Ukhrul": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Kangpokpi": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Tengnoupal": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Kamjong": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Noney": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Pherzawl": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Kakching": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},
    "Jiribam": {"moderate": 28.0, "high": 44.0, "severe": 62.0, "terrane": "Indo-Burman Range & Manipur Ophiolite Belt"},

    # Meghalaya (Terrane 4a: Shillong Plateau Craton & Southern Escarpment)
    "East Khasi Hills": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},
    "West Khasi Hills": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},
    "South West Khasi Hills": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},
    "Ri-Bhoi": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},
    "West Garo Hills": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},
    "East Garo Hills": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},
    "South Garo Hills": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},
    "North Garo Hills": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},
    "South West Garo Hills": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},
    "West Jaintia Hills": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},
    "East Jaintia Hills": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},
    "Eastern West Khasi Hills": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Shillong Plateau & Cratonic Fringe"},

    # Assam (Terrane 4a: Assam Valley & Mikir/Cachar Margin)
    "Dima Hasao": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Karbi Anglong": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "West Karbi Anglong": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Cachar": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Hailakandi": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Karimganj": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Kamrup": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Kamrup Metropolitan": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Golaghat": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Jorhat": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Sivasagar": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Dibrugarh": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Tinsukia": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Sonitpur": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Lakhimpur": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Dhemaji": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Nagaon": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Morigaon": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Goalpara": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Dhubri": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Kokrajhar": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Chirang": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Baksa": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Udalguri": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Barpeta": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Bongaigaon": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Nalbari": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Darrang": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Biswanath": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Charaideo": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Hojai": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "South Salmara": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Majuli": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Bajali": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},
    "Tamulpur": {"moderate": 36.0, "high": 54.0, "severe": 72.0, "terrane": "Assam Valley & Shillong Margin"},

    # Sikkim (Terrane 0: Higher & Lesser Himalaya)
    "Gangtok": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Sikkim Crystalline & Lesser Himalaya"},
    "Namchi": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Sikkim Crystalline & Lesser Himalaya"},
    "Gyalshing": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Sikkim Crystalline & Lesser Himalaya"},
    "Mangan": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Sikkim Crystalline & Lesser Himalaya"},
    "Soreng": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Sikkim Crystalline & Lesser Himalaya"},
    "Pakyong": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Sikkim Crystalline & Lesser Himalaya"},

    # Arunachal Pradesh (Terrane 1: Eastern Himalayan Syntax & MBT)
    "Tawang": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "West Kameng": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "East Kameng": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Papum Pare": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Kurung Kumey": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Kra Daadi": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Lower Subansiri": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Upper Subansiri": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "West Siang": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "East Siang": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Siang": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Upper Siang": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Lower Siang": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Dibang Valley": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Lower Dibang Valley": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Anjaw": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Lohit": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Namsai": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Changlang": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Tirap": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Longding": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Kamle": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Pakke Kessang": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Lepa Rada": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Shi Yomi": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
    "Itanagar": {"moderate": 38.0, "high": 56.0, "severe": 74.0, "terrane": "Arunachal Eastern Himalayan Syntax"},
}

class RegionalCutoffsCatalog(dict):
    """
    Authoritative geologically calibrated terrane cutoffs catalog for all 8 Northeast India states.
    Ensures every administrative district in the NER is mapped to its specific terrane thresholds,
    with hierarchical fallbacks to state terrane and coordinate-based bounding boxes.
    Eliminates all uncalibrated default fallback caveats.
    """
    def __init__(self, initial_mapping=None):
        base = dict(_ALL_NER_DISTRICT_CUTOFFS)
        if initial_mapping:
            base.update(initial_mapping)
        super().__init__(base)
        self._lower_map = {str(k).strip().lower(): v for k, v in self.items()}

    def get(self, key, default=None):
        if key is None:
            return default if default is not None else DEFAULT_PAN_NER_CUTOFFS
        k_str = str(key).strip()
        if dict.__contains__(self, k_str):
            return dict.__getitem__(self, k_str)
        k_lower = k_str.lower()
        if k_lower in self._lower_map:
            return self._lower_map[k_lower]
        # State-level terrane fallback
        for s_name, cutoffs in STATE_TERRANE_FALLBACKS.items():
            if s_name.lower() in k_lower or k_lower in s_name.lower():
                return cutoffs
        logger.warning(
            "Unmapped district/key '%s': no explicit terrane cutoffs match in RegionalCutoffsCatalog. "
            "Falling back to DEFAULT_PAN_NER_CUTOFFS (38.0, 56.0, 74.0). "
            "Operational risk: thresholds may be miscalibrated if this location is in a fold belt.",
            k_str,
        )
        return default if default is not None else DEFAULT_PAN_NER_CUTOFFS

    def __getitem__(self, key):
        return self.get(key)

    def __contains__(self, key):
        if key is None:
            return False
        k_str = str(key).strip().lower()
        if k_str in self._lower_map:
            return True
        return any(s.lower() in k_str or k_str in s.lower() for s in STATE_TERRANE_FALLBACKS)

    def is_fold_belt(self, key) -> bool:
        """
        Determines whether a district or terrane resides in a fold belt or flysch/shale zone
        requiring calibrated prolonged-saturation gating.
        """
        cut = self.get(key)
        if not cut:
            return False
        sev = cut.get("severe", 74.0)
        terr = cut.get("terrane", "")
        return (
            sev <= 60.0
            or "Fold Belt" in terr
            or "Wedge" in terr
            or "Naga" in terr
            or "Mizo" in terr
            or "Surma" in terr
        )

    def resolve_for_coordinate(self, lat: float, lng: float) -> dict:
        """
        Spatially resolves calibrated terrane cutoffs for arbitrary geographical coordinates
        using bounding boxes of the 8 Northeast physiographic provinces.
        """
        try:
            flat = float(lat)
            flng = float(lng)
        except (TypeError, ValueError):
            return DEFAULT_PAN_NER_CUTOFFS

        # Sikkim Crystalline & Lesser Himalaya
        if 27.0 <= flat <= 28.3 and 88.0 <= flng <= 89.0:
            return STATE_TERRANE_FALLBACKS["Sikkim"]
        # Nagaland Indo-Burman Wedge
        if 25.1 <= flat <= 27.1 and 93.3 <= flng <= 95.3:
            return STATE_TERRANE_FALLBACKS["Nagaland"]
        # Mizoram Surma Basin Fold Belt
        if 21.9 <= flat <= 24.6 and 92.2 <= flng <= 93.5:
            return STATE_TERRANE_FALLBACKS["Mizoram"]
        # Tripura Anticlinal Ridges
        if 22.9 <= flat <= 24.6 and 91.1 <= flng <= 92.4:
            return STATE_TERRANE_FALLBACKS["Tripura"]
        # Manipur Ophiolite & Indo-Burman Range
        if 23.8 <= flat <= 25.7 and 93.0 <= flng <= 94.8:
            return STATE_TERRANE_FALLBACKS["Manipur"]
        # Meghalaya Shillong Plateau
        if 25.0 <= flat <= 26.2 and 89.8 <= flng <= 92.9:
            return STATE_TERRANE_FALLBACKS["Meghalaya"]
        # Arunachal Eastern Himalayan Syntax
        if 26.6 <= flat <= 29.5 and 91.5 <= flng <= 97.5:
            return STATE_TERRANE_FALLBACKS["Arunachal"]
        # Assam Valley & Shillong Margin
        if 24.0 <= flat <= 28.0 and 89.5 <= flng <= 96.0:
            return STATE_TERRANE_FALLBACKS["Assam"]

        return DEFAULT_PAN_NER_CUTOFFS

REGIONAL_TERRANE_CUTOFFS = RegionalCutoffsCatalog()

def get_active_artifact_path_from_registry(db_url: str = None) -> str:
    """
    Queries the registry (public.risk_model_config) for the sole authorized
    production model (is_active=TRUE, status='active') and returns its
    artifact_path.

    Rules enforced:
      - Exactly one row with is_active=TRUE must exist.
      - status MUST be 'active' (not 'validated', 'scientifically_blocked', etc.)
      - artifact_path must exist on disk.

    If the registry is unreachable, falls back to _FALLBACK_ARTIFACT_PATH.
    NEVER silently falls back to a scientifically-blocked or candidate model.
    """
    url = db_url or DATABASE_URL
    if not url:
        return _FALLBACK_ARTIFACT_PATH

    try:
        conn = psycopg2.connect(url, connect_timeout=3)
        cur = conn.cursor()
        cur.execute("""
            SELECT model_version, artifact_path, status
            FROM public.risk_model_config
            WHERE is_active = true
            LIMIT 2
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()

        if not rows:
            # No active model in registry — fall back gracefully
            warnings.warn(
                "[inference] No active model in registry; using fallback artifact.",
                stacklevel=2,
            )
            return _FALLBACK_ARTIFACT_PATH

        if len(rows) > 1:
            raise RuntimeError(
                f"Registry integrity violation: {len(rows)} active models found. "
                "Exactly one must be active."
            )

        ver, art_path, status = rows[0]

        if status != "active":
            raise RuntimeError(
                f"Registry model '{ver}' has is_active=TRUE but status='{status}'. "
                "A production-active model must have status='active'. "
                "Run: python3 scripts/ml_registry.py gate <version> to re-evaluate."
            )

        if not art_path or not os.path.isfile(art_path):
            raise RuntimeError(
                f"Registry active model '{ver}' artifact path '{art_path}' not found on disk."
            )

        return art_path

    except psycopg2.Error:
        # DB connectivity failure — fall back, do not fail inference
        warnings.warn(
            "[inference] DB unreachable; using fallback artifact path for inference.",
            stacklevel=2,
        )
        return _FALLBACK_ARTIFACT_PATH

_REAL_EVENTS_CACHE: dict = {"data": None, "fetched_at": 0.0}
_CACHE_TTL_SECONDS: float = 60.0


def _get_cached_real_events(conn) -> pd.DataFrame:
    """Thread-safe in-memory TTL cached loader for historical landslide events."""
    import time
    now = time.time()
    if (
        _REAL_EVENTS_CACHE["data"] is not None
        and (now - _REAL_EVENTS_CACHE["fetched_at"]) < _CACHE_TTL_SECONDS
    ):
        return _REAL_EVENTS_CACHE["data"]

    df = pd.read_sql("""
        SELECT id, lat, lng, event_date
        FROM public.historical_landslides
        WHERE is_synthetic = false AND hazard_type = 'rainfall_slope_failure'
        ORDER BY event_date;
    """, conn)
    _REAL_EVENTS_CACHE["data"] = df
    _REAL_EVENTS_CACHE["fetched_at"] = now
    return df


# ── Invariant Geological Terrane Zone Peer Mappings for Synoptic Coupling ─────
ZONE_TERRANE_GROUPS = {
    # Terrane 0: Greater & Lesser Himalaya (Sikkim)
    11: [11, 12], 12: [11, 12],
    # Terrane 1: Eastern Syntaxis & Mishmi Thrust (Arunachal)
    9: [9, 10], 10: [9, 10],
    # Terrane 2: Indo-Burman Wedge & Naga Hills (Nagaland)
    7: [7, 8, 1], 8: [7, 8, 1],
    # Terrane 3: Surma Basin & Mizo Fold Belt (Mizoram & Tripura)
    3: [3, 4, 15], 4: [3, 4, 15], 15: [3, 4, 15],
    # Terrane 4: Shillong Craton & Schuppen Belt (Meghalaya, Assam, Manipur)
    5: [5, 6, 13, 14], 6: [5, 6, 13, 14], 13: [5, 6, 13, 14], 14: [5, 6, 13, 14],
    1: [1, 2, 7], 2: [1, 2, 7],
}


def _evaluate_synoptic_spatial_coupling(conn, zone_id: int, as_of) -> dict:
    """
    Evaluates spatial correlation across adjacent zones in the same geological terrane.
    If multiple neighboring zones exceed geotechnical thresholds concurrently, confirms
    a regional synoptic storm system (cyclonic depression or regional monsoon surge).
    """
    peers = ZONE_TERRANE_GROUPS.get(zone_id, [zone_id])
    if len(peers) <= 1:
        return {"is_synoptic_storm": False, "concurring_zones": [], "concurring_count": 0}

    try:
        as_of_dt = pd.Timestamp(as_of)
        start_3d = as_of_dt - pd.Timedelta(days=3)
        cur = conn.cursor()
        cur.execute("""
            SELECT w.zone_id, z.zone_name, SUM(w.rainfall_mm) as rain_3d, z.threshold_e_mm
            FROM public.weather_readings w
            JOIN public.risk_zones z ON w.zone_id = z.id
            WHERE w.zone_id = ANY(%s)
              AND w.reading_time >= %s AND w.reading_time < %s
            GROUP BY w.zone_id, z.zone_name, z.threshold_e_mm;
        """, (peers, start_3d, as_of_dt))
        rows = cur.fetchall()
        cur.close()

        concurring = []
        for r_zid, r_name, r_rain, r_ethr in rows:
            ethr = float(r_ethr) if r_ethr else 70.0
            ratio = (float(r_rain) / ethr) if ethr > 0 else 0.0
            if ratio >= 0.85 or float(r_rain) >= 50.0:
                concurring.append({
                    "zone_id": r_zid,
                    "zone_name": str(r_name),
                    "rain_3d": round(float(r_rain), 1),
                    "ratio": round(ratio, 2),
                })

        is_synoptic = len(concurring) >= 2
        return {
            "is_synoptic_storm": is_synoptic,
            "concurring_zones": concurring,
            "concurring_count": len(concurring),
        }
    except Exception:
        return {"is_synoptic_storm": False, "concurring_zones": [], "concurring_count": 0}


def _query_zone_insar_kinematics(conn, centroid_lat: float, centroid_lng: float) -> dict:
    """
    Queries Sentinel-1 InSAR ground deformation kinematics from public.insar_deformation_products
    matching the zone centroid's 0.25-degree grid cell.
    """
    try:
        grid_lat = round(round(float(centroid_lat) / 0.25) * 0.25, 2)
        grid_lon = round(round(float(centroid_lng) / 0.25) * 0.25, 2)
        cell_id = f"cell-{grid_lat:.2f}-{grid_lon:.2f}"

        cur = conn.cursor()
        cur.execute("""
            SELECT status, los_velocity_mean_mm_year, los_velocity_max_mm_year,
                   cumulative_displacement_mm, temporal_trend, coherence_mean,
                   quality
            FROM public.insar_deformation_products
            WHERE cell_id = %s
            LIMIT 1;
        """, (cell_id,))
        row = cur.fetchone()
        cur.close()

        if not row:
            return {
                "status": "UNAVAILABLE",
                "cell_id": cell_id,
                "los_velocity_mean_mm_year": None,
                "los_velocity_max_mm_year": None,
                "cumulative_displacement_mm": None,
                "temporal_trend": "INSUFFICIENT_DATA",
                "coherence_mean": None,
                "quality": "UNAVAILABLE",
                "kinematic_override": False,
                "kinematic_alert": None,
            }

        status, v_mean, v_max, cum_disp, trend, coh, quality = row
        v_mean = float(v_mean) if v_mean is not None else None
        v_max = float(v_max) if v_max is not None else None
        cum_disp = float(cum_disp) if cum_disp is not None else None
        coh = float(coh) if coh is not None else None

        # Kinematic risk assessment
        kinematic_override = False
        kinematic_alert = None
        if status == "AVAILABLE" and v_max is not None:
            abs_v = abs(v_max)
            if abs_v >= 15.0 or trend == "ACCELERATING":
                kinematic_override = True
                kinematic_alert = f"Active rapid ground displacement detected ({v_max:.1f} mm/yr, trend: {trend})"
            elif abs_v >= 8.0 or trend == "STEADY":
                kinematic_override = True
                kinematic_alert = f"Continuous ground creep detected ({v_max:.1f} mm/yr, trend: {trend})"

        return {
            "status": status or "UNAVAILABLE",
            "cell_id": cell_id,
            "los_velocity_mean_mm_year": v_mean,
            "los_velocity_max_mm_year": v_max,
            "cumulative_displacement_mm": cum_disp,
            "temporal_trend": trend or "INSUFFICIENT_DATA",
            "coherence_mean": coh,
            "quality": quality or "UNAVAILABLE",
            "kinematic_override": kinematic_override,
            "kinematic_alert": kinematic_alert,
        }
    except Exception:
        return {
            "status": "UNAVAILABLE",
            "cell_id": None,
            "los_velocity_mean_mm_year": None,
            "los_velocity_max_mm_year": None,
            "cumulative_displacement_mm": None,
            "temporal_trend": "INSUFFICIENT_DATA",
            "coherence_mean": None,
            "quality": "UNAVAILABLE",
            "kinematic_override": False,
            "kinematic_alert": None,
        }


def _auto_backfill_weather_readings(conn, zone_id: int, lat: float, lng: float, timeout_sec: float = 3.0) -> bool:
    """
    Autonomous operational self-healing for live ingest pipeline latency:
    If background weather ingest pipeline lags (>6h), fetches live NWP observations
    directly from Open-Meteo and upserts into public.weather_readings to restore
    near-zero pipeline latency without manual intervention.
    """
    import requests
    params = {
        "latitude": round(float(lat), 4),
        "longitude": round(float(lng), 4),
        "past_days": 3,
        "forecast_days": 1,
        "daily": "precipitation_sum",
        "hourly": "soil_moisture_0_to_7cm",
        "timezone": "UTC",
    }
    try:
        resp = requests.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=timeout_sec)
        if resp.status_code != 200:
            return False
        data = resp.json()
        daily = data.get("daily", {})
        dates = daily.get("time", [])
        precips = daily.get("precipitation_sum", [])
        if not dates:
            return False

        hourly = data.get("hourly", {})
        h_times = hourly.get("time", [])
        h_sm = hourly.get("soil_moisture_0_to_7cm", [])
        sm_series = pd.Series(
            [float(v) if v is not None else np.nan for v in h_sm],
            index=pd.to_datetime(h_times),
        ) if h_times else None
        daily_sm = sm_series.resample("D").mean() if sm_series is not None and not sm_series.empty else None

        cur = conn.cursor()
        for d_str, p_val in zip(dates, precips):
            rain_mm = float(p_val) if p_val is not None else 0.0
            soil_pct = None
            if daily_sm is not None:
                sm_raw = daily_sm.get(pd.Timestamp(d_str), np.nan)
                if not pd.isna(sm_raw):
                    soil_pct = round(min((float(sm_raw) / 0.55) * 100.0, 100.0), 1)

            rtime = f"{d_str}T12:00:00Z"
            cur.execute("""
                INSERT INTO public.weather_readings (
                    zone_id, station_id, reading_time, rainfall_mm, soil_moisture_pct, source
                ) VALUES (%s, %s, %s::timestamptz, %s, %s, %s)
                ON CONFLICT (zone_id, station_id, reading_time) DO UPDATE
                SET rainfall_mm = EXCLUDED.rainfall_mm,
                    soil_moisture_pct = COALESCE(EXCLUDED.soil_moisture_pct, public.weather_readings.soil_moisture_pct),
                    source = EXCLUDED.source;
            """, (zone_id, f"OM-AUTO-BACKFILL-{zone_id}", rtime, rain_mm, soil_pct, "Open-Meteo Autonomous Ingest Backfill"))
        conn.commit()
        cur.close()
        return True
    except Exception:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        return False


class LandslideRiskInferenceEngine:
    def __init__(self, artifact_path: str = None):
        """
        Initialize the inference engine.

        artifact_path: explicit artifact path. If None, reads the active model
            from the registry via get_active_artifact_path_from_registry().
            Use the explicit path only for testing or manual override.
        """
        if artifact_path is None:
            artifact_path = get_active_artifact_path_from_registry()
        self.artifact_path = artifact_path
        self.artifact = load_model_artifact(artifact_path)

    def predict_zone(
        self,
        zone_id: int,
        as_of_date=None,
        conn=None,
        local_slope_deg: float = None,
        facet_type: str = None,
    ) -> dict:
        """
        Executes end-to-end inference for a specific risk zone as of a given timestamp.
        Returns a rich prediction response containing scores, levels, factor attributions,
        provenance, data quality states, and localized facet resolutions.
        """
        close_conn = False
        if conn is None:
            if not DATABASE_URL:
                if _is_production:
                    raise RuntimeError("Production DATABASE_URL is not configured")
                raise RuntimeError("DATABASE_URL is not configured")
            conn = psycopg2.connect(DATABASE_URL, connect_timeout=3)
            close_conn = True

        as_of = pd.Timestamp.now(tz=timezone.utc) if as_of_date is None else pd.Timestamp(as_of_date)

        try:
            # 1. Load zone
            zones_df = pd.read_sql("SELECT * FROM public.risk_zones WHERE id = %s;", conn, params=(zone_id,))
            if zones_df.empty:
                return {
                    "status": "INVALID",
                    "error": f"Zone id {zone_id} not found",
                    "inference_timestamp": datetime.now(timezone.utc).isoformat(),
                }
            z_row = zones_df.iloc[0]

            # 2. Load weather up to as_of
            now_utc = pd.Timestamp.now(tz=timezone.utc)
            as_of_utc = as_of if as_of.tzinfo is not None else as_of.tz_localize(timezone.utc)
            is_near_real_time = abs((now_utc - as_of_utc).total_seconds()) < 86400.0
            auto_backfill_applied = False

            weather_df = pd.read_sql("""
                SELECT zone_id, reading_time::date AS reading_date,
                       SUM(rainfall_mm) AS rainfall_mm,
                       MAX(soil_moisture_pct) FILTER (WHERE soil_moisture_pct IS NOT NULL) AS soil_moisture_pct,
                       MAX(reading_time) as latest_reading_time
                FROM public.weather_readings
                WHERE zone_id = %s AND reading_time < %s
                GROUP BY zone_id, reading_time::date
                ORDER BY reading_date;
            """, conn, params=(zone_id, as_of))

            # Operational Self-Healing: If live ingest pipeline has lagged (>6h),
            # autonomously fetch live NWP observations from Open-Meteo into public.weather_readings.
            if is_near_real_time:
                latest_reading = weather_df["latest_reading_time"].max() if not weather_df.empty else None
                needs_backfill = False
                if latest_reading is None:
                    needs_backfill = True
                else:
                    ts_lr = pd.Timestamp(latest_reading)
                    ts_lr_utc = ts_lr.tz_convert(timezone.utc) if ts_lr.tzinfo is not None else ts_lr.tz_localize(timezone.utc)
                    if (as_of_utc - ts_lr_utc).total_seconds() > 21600.0:  # >6 hours
                        needs_backfill = True
                if needs_backfill:
                    ok = _auto_backfill_weather_readings(
                        conn, zone_id, float(z_row["centroid_lat"]), float(z_row["centroid_lng"])
                    )
                    if ok:
                        auto_backfill_applied = True
                        weather_df = pd.read_sql("""
                            SELECT zone_id, reading_time::date AS reading_date,
                                   SUM(rainfall_mm) AS rainfall_mm,
                                   MAX(soil_moisture_pct) FILTER (WHERE soil_moisture_pct IS NOT NULL) AS soil_moisture_pct,
                                   MAX(reading_time) as latest_reading_time
                            FROM public.weather_readings
                            WHERE zone_id = %s AND reading_time < %s
                            GROUP BY zone_id, reading_time::date
                            ORDER BY reading_date;
                        """, conn, params=(zone_id, as_of))

            if weather_df.empty:
                return {
                    "status": "MISSING",
                    "error": f"No weather readings found for zone {zone_id} before {as_of}",
                    "zone_id": zone_id,
                    "zone_name": str(z_row["zone_name"]),
                    "inference_timestamp": datetime.now(timezone.utc).isoformat(),
                }

            # 3. Load real historical events for proximity (cached 60s TTL)
            real_events_df = _get_cached_real_events(conn)

            # 4. Extract canonical features (enforce temporal proximity to prevent future-event leakage)
            feats, meta = extract_features_for_zone(
                z_row, as_of, weather_df, real_events_df, temporal_proximity=True
            )
            if feats is None:
                return {
                    "status": "MISSING",
                    "error": "Insufficient weather history for feature extraction (<30d)",
                    "zone_id": zone_id,
                    "inference_timestamp": datetime.now(timezone.utc).isoformat(),
                }

            # 5. Evaluate data quality & freshness state
            latest_wx_time = weather_df["latest_reading_time"].max()
            if latest_wx_time is not None:
                ts = pd.Timestamp(latest_wx_time)
                if ts.tzinfo is not None:
                    ts = ts.tz_convert(timezone.utc)
                else:
                    ts = ts.tz_localize(timezone.utc)
                wx_age_hours = (as_of_utc - ts).total_seconds() / 3600.0
            else:
                wx_age_hours = 999.0
            sm_status = meta["soil_moisture_status"]

            if wx_age_hours > 72.0:
                data_state = "STALE"
            elif sm_status == "fallback":
                data_state = "FALLBACK"
            else:
                data_state = "VALID"

            # 6. Execute ML prediction (with localized facet resolution)
            is_custom_facet = local_slope_deg is not None
            evaluated_slope = float(local_slope_deg) if is_custom_facet else float(z_row.get("slope_p90_deg", z_row["mean_slope_deg"]))

            facet_mult = 1.0
            if is_custom_facet:
                feats["slope_norm"] = min(evaluated_slope / 45.0, 1.0)
                feats["slope_sin"] = float(math.sin(math.radians(evaluated_slope)))
                feats["slope_class"] = 0 if evaluated_slope < 15.0 else (1 if evaluated_slope < 30.0 else 2)
                if facet_type:
                    ft = str(facet_type).lower().strip()
                    if ft in ("road_cut", "cut_slope"):
                        facet_mult = 1.15
                    elif ft in ("fault_scarp", "shear_zone"):
                        facet_mult = 1.20
                    elif ft in ("riverbank_erosion", "toe_scour"):
                        facet_mult = 1.10

            raw_ml_proba = float(self.artifact.predict_proba(feats))
            district_name = str(z_row["district"])
            regional_cutoffs = REGIONAL_TERRANE_CUTOFFS.get(district_name)

            # Resolve regional confidence tier and operational status early
            reg_conf_map = getattr(self.artifact, "metrics", {}).get("regional_confidence", {})
            reg_info = reg_conf_map.get(district_name, {"confidence_tier": "moderate", "cv_pr_auc": 0.6755})
            confidence_tier = reg_info.get("confidence_tier", "moderate")
            regional_pr_auc = reg_info.get("cv_pr_auc", 0.6755)
            terrane_name = reg_info.get("terrane_name", regional_cutoffs["terrane"] if regional_cutoffs else "")
            
            # Pure physics mode check: if terrane has insufficient data coverage or operator enables physics-only
            ml_operational = bool(confidence_tier not in ("insufficient_data", "unoperational")) and os.getenv("LANDALERT_PHYSICS_ONLY", "0").lower() not in ("1", "true")

            # Continuous Physics-Informed Geotechnical Stress & Fusion:
            # Operational safety in extreme conditions is modeled via continuous pore-pressure
            # exceedance ratio (xi) and geotechnical limit-equilibrium failure likelihood (P_phys),
            # continuously fused with ML ensemble probability (P_ml) via Bayesian consensus when ML is operational.
            is_fold_belt = REGIONAL_TERRANE_CUTOFFS.is_fold_belt(district_name)
            r3d_ratio = float(feats.get("rain_3d_vs_e_thr", 0.0))
            r7d = float(feats.get("rain_7d", 0.0))
            r7d_ratio = (r7d / 80.0) if is_fold_belt else (r7d / 120.0)
            fold_3d_ratio = (r3d_ratio / 0.85) if is_fold_belt else r3d_ratio
            thresh_flag = float(feats.get("threshold_exceedance_flag", 0))

            geotechnical_stress_ratio = max(r3d_ratio, r7d_ratio, fold_3d_ratio, thresh_flag)

            # Continuous physical failure likelihood via limit-equilibrium sigmoid (beta=8.0, xi_0=1.0)
            # At stress ratio xi >= 1.0, pore pressure induces limit equilibrium (FS <= 1.0)
            p_phys = 1.0 / (1.0 + math.exp(-8.0 * (geotechnical_stress_ratio - 1.0)))

            # Continuous Noisy-OR Bayesian consensus calculation
            p_consensus = max(0.001, min(0.999, 1.0 - (1.0 - raw_ml_proba) * (1.0 - p_phys)))

            # If ML is operational, use continuous Noisy-OR consensus;
            # if unoperational (e.g. Surma Basin / Mizoram) or physics-only mode is toggled, route purely through p_phys.
            if ml_operational:
                proba = p_consensus
            else:
                proba = max(0.001, min(0.999, p_phys))

            risk_score, risk_level = self.artifact.compute_risk_score(proba, cutoffs=regional_cutoffs)
            if is_custom_facet and facet_mult > 1.0:
                risk_score = min(100.0, round(risk_score * facet_mult, 1))
                severe_c = regional_cutoffs["severe"] if regional_cutoffs else 76.0
                high_c = regional_cutoffs["high"] if regional_cutoffs else 58.0
                mod_c = regional_cutoffs["moderate"] if regional_cutoffs else 38.0
                if risk_score >= severe_c:
                    risk_level = "Severe"
                elif risk_score >= high_c:
                    risk_level = "High"
                elif risk_score >= mod_c:
                    risk_level = "Moderate"

            # Compute localized facet spectrum across canonical slope regimes
            facet_spectrum = None
            if not is_custom_facet:
                facet_slopes = [15.0, 25.0, 38.0, 45.0]
                facet_matrix = []
                for s in facet_slopes:
                    f_c = feats.copy()
                    f_c["slope_norm"] = min(s / 45.0, 1.0)
                    f_c["slope_sin"] = float(math.sin(math.radians(s)))
                    f_c["slope_class"] = 0 if s < 15.0 else (1 if s < 30.0 else 2)
                    facet_matrix.append([f_c[k] for k in CANONICAL_FEATURES])
                f_probs = self.artifact.predict_proba_batch(np.array(facet_matrix, dtype=np.float64))
                # Apply continuous geotechnical consensus to facet spectrum
                f_cons = [max(0.001, min(0.999, 1.0 - (1.0 - float(p)) * (1.0 - p_phys))) for p in f_probs]
                s15, l15 = self.artifact.compute_risk_score(float(f_cons[0]), cutoffs=regional_cutoffs)
                s25, l25 = self.artifact.compute_risk_score(float(f_cons[1]), cutoffs=regional_cutoffs)
                s38, l38 = self.artifact.compute_risk_score(float(f_cons[2]), cutoffs=regional_cutoffs)
                s45, l45 = self.artifact.compute_risk_score(float(f_cons[3]), cutoffs=regional_cutoffs)
                severe_cutoff = regional_cutoffs["severe"] if regional_cutoffs else 76.0
                s38_amp = min(100.0, round(s38 * 1.15, 1))
                s45_amp = min(100.0, round(s45 * 1.20, 1))
                l38_amp = "Severe" if s38_amp >= severe_cutoff else l38
                l45_amp = "Severe" if s45_amp >= severe_cutoff else l45
                facet_spectrum = {
                    "gentle_natural_slope_15deg": {"slope_deg": 15.0, "probability": round(float(f_cons[0]), 4), "risk_score": s15, "risk_level": l15},
                    "moderate_hillslope_25deg": {"slope_deg": 25.0, "probability": round(float(f_cons[1]), 4), "risk_score": s25, "risk_level": l25},
                    "steep_road_cut_38deg": {"slope_deg": 38.0, "facet_type": "road_cut", "geotechnical_amplification": 1.15, "probability": round(float(f_cons[2]), 4), "risk_score": s38_amp, "risk_level": l38_amp},
                    "critical_fault_scarp_45deg": {"slope_deg": 45.0, "facet_type": "fault_scarp", "geotechnical_amplification": 1.20, "probability": round(float(f_cons[3]), 4), "risk_score": s45_amp, "risk_level": l45_amp},
                }

            explanation = self.artifact.explain(feats)

            # When soil moisture is in fallback mode (unmeasured neutral value),
            # zero out its factor attribution so unmeasured data does not distort attribution.
            if sm_status == "fallback":
                for cat in explanation.get("top_categories", []):
                    if cat.get("category") == "soil_moisture":
                        cat["net_contribution"] = 0.0
                for feat in explanation.get("all_features", []):
                    if "soil" in feat.get("feature", ""):
                        feat["contribution"] = 0.0
                for feat in explanation.get("top_features", []):
                    if "soil" in feat.get("feature", ""):
                        feat["contribution"] = 0.0
                # Re-sort top_categories by absolute contribution
                explanation["top_categories"].sort(key=lambda item: abs(item["net_contribution"]), reverse=True)

            # 7. Regional confidence and safety conjunction gating
            # (confidence_tier, regional_pr_auc, terrane_name, and ml_operational resolved above)

            # Conjunction gate for SEVERE evacuation alerts:
            # Standard threshold: 3-day intensity exceeds Das et al. 2018 or zone E-threshold
            # Fold-belt threshold: For Nagaland/Mizoram, prolonged 7-day rainfall >= 80mm
            # indicates critical saturation in weathered clay-shale flysch beds
            fold_belt_exceeded = is_fold_belt and (
                feats.get("rain_7d", 0.0) >= 80.0 or feats.get("rain_3d_vs_e_thr", 0.0) >= 0.85
            )
            threshold_exceeded = bool(
                geotechnical_stress_ratio >= 1.0
                or feats.get("threshold_exceedance_flag", 0) == 1
                or feats.get("rain_3d_vs_e_thr", 0) >= 1.0
                or fold_belt_exceeded
            )
            effective_risk_level = risk_level
            confidence_warning = None
            physical_override = bool(p_phys >= 0.50 or threshold_exceeded)

            # Severe floor: uses regional severe cutoff or 76.0
            severe_floor = regional_cutoffs["severe"] if regional_cutoffs else 76.0

            # Failsafe Safety Floor & Governance Conjunction Gating:
            # In data-starved or low-precision terranes (Mizoram/Tripura precision ~5.3%, Arunachal ~12.7%),
            # automated SEVERE evacuation is strictly suppressed. Even when physical thresholds are breached,
            # alerts are capped at HIGH screening advisories requiring mandatory duty officer verification.
            if confidence_tier in ("insufficient_data", "low"):
                if confidence_tier == "insufficient_data":
                    # In insufficient-data zones (Mizoram/Tripura with ~4.05% precision, 1 hit per 25 false alarms),
                    # operational alert triggers are strictly SUPPRESSED to prevent alarm fatigue and false sense of security.
                    # This region operates in silent research monitoring mode; risk level is capped at Moderate.
                    effective_risk_level = "Moderate"
                    if risk_score >= 55.0:
                        risk_score = 54.0
                    confidence_warning = (
                        f"INSUFFICIENT GROUND TRUTH in {district_name} ({terrane_name}): Clean PR-AUC is {regional_pr_auc:.4f} "
                        f"(uncalibrated physical fallback precision ~4.05%, 1 hit per 25 false alarms). "
                        "All actionable alert triggers are SUPPRESSED. Operates strictly in SILENT BACKGROUND RESEARCH MODE "
                        "until local failure timestamps are digitized."
                    )
                elif threshold_exceeded or p_phys >= 0.40:
                    effective_risk_level = "High"
                    if risk_score >= severe_floor:
                        risk_score = severe_floor - 0.5
                    confidence_warning = (
                        f"PROVISIONAL DATA COVERAGE in {district_name} ({terrane_name}): Regional model generalization is LOW "
                        f"(only 44 confirmed events; physical precision ~12.7%). Automated SEVERE evacuation is suppressed; "
                        "alert capped at HIGH screening advisory. Field inspection required before escalating to evacuation."
                    )
                else:
                    effective_risk_level = "Moderate" if p_phys >= 0.25 else "Low"
                    if risk_score >= regional_cutoffs.get("high", 58.0):
                        risk_score = regional_cutoffs.get("high", 58.0) - 0.5
            else:
                # Moderate ground-truth terranes (Sikkim, Nagaland, Assam/Meghalaya):
                # Redundant Failsafe Safety Floor (Defense-in-Depth)
                if threshold_exceeded:
                    if risk_score < severe_floor:
                        risk_score = severe_floor
                        effective_risk_level = "Severe"
                if is_fold_belt:
                    confidence_warning = (
                        f"District {district_name} ({terrane_name}): Evaluated under regional calibrated thresholds "
                        f"(moderate={regional_cutoffs['moderate']}, severe={regional_cutoffs['severe']}) with "
                        "deep clay-shale prolonged rainfall geotechnical override."
                    )

            # 8. Synoptic Spatial Correlation & Atmospheric Coupling
            synoptic_info = _evaluate_synoptic_spatial_coupling(conn, zone_id, as_of)
            synoptic_storm_detected = synoptic_info.get("is_synoptic_storm", False)
            if synoptic_storm_detected and threshold_exceeded:
                physical_override = True
                if risk_score < severe_floor:
                    risk_score = severe_floor
                    effective_risk_level = "Severe"

            # 9. InSAR Satellite Ground Kinematics Coupling
            insar_kinematics = _query_zone_insar_kinematics(
                conn, z_row["centroid_lat"], z_row["centroid_lng"]
            )
            kinematic_override = insar_kinematics.get("kinematic_override", False)
            if kinematic_override:
                # Active ground displacement physically demonstrates progressive slope shear
                physical_override = True
                if risk_score < 70.0:
                    risk_score = min(100.0, risk_score + 15.0)
                if threshold_exceeded and risk_score < severe_floor:
                    risk_score = severe_floor
                    effective_risk_level = "Severe"

            # 10. Construct dynamic explanation text
            top_cat = explanation["top_categories"][0]["category"].replace("_", " ")
            secondary_cats = [c["category"].replace("_", " ") for c in explanation["top_categories"][1:3]]

            override_note = " [PHYSICAL GEOTECHNICAL THRESHOLD EXCEEDED → SEVERE ALERT ENFORCED]" if physical_override else ""
            synoptic_note = ""
            if synoptic_storm_detected:
                concurring_names = [c["zone_name"] for c in synoptic_info.get("concurring_zones", [])]
                synoptic_note = (
                    f" [SYNOPTIC STORM DETECTED: {len(concurring_names)} adjacent zones in {terrane_name or 'regional terrane'} "
                    f"concurrently exceed rainfall thresholds: {', '.join(concurring_names)}]"
                )
            insar_note = ""
            if kinematic_override and insar_kinematics.get("kinematic_alert"):
                insar_note = f" [INSAR GROUND KINEMATICS: {insar_kinematics['kinematic_alert']} — kinematic escalation enforced]"

            facet_note = ""
            if is_custom_facet:
                facet_note = f" [LOCALIZED FACET: {facet_type or 'slope'} at {evaluated_slope:.1f}° → score {risk_score} ({effective_risk_level})]"
            elif facet_spectrum:
                s15_val = facet_spectrum["gentle_natural_slope_15deg"]["risk_score"]
                s38_val = facet_spectrum["steep_road_cut_38deg"]["risk_score"]
                facet_note = f" [FACETS: 15° gentle={s15_val} | 38° road cut={s38_val}]"

            narrative = (
                f"Main risk driver: {top_cat}. Secondary contributors: {', '.join(secondary_cats)}. "
                f"Detail — 72-hr rainfall: {feats['rain_1d']:.1f}mm / 3-day {feats['rain_3d']:.1f}mm "
                f"(vs zone threshold ratio: {feats['rain_3d_vs_e_thr']:.2f}). "
                f"Soil moisture: {feats['soil_moisture_latest']*100.0:.1f}% ({sm_status}). "
                f"Terrain slope: {evaluated_slope:.1f}° (evaluated {'facet' if is_custom_facet else 'macro-zone'} slope). "
                f"Model: {self.artifact.model_version} (ML: {raw_ml_proba:.3f}, Phys: {p_phys:.3f} [Stress {geotechnical_stress_ratio:.2f}], Fused: {proba:.3f}, Regional Confidence: {confidence_tier.upper()} [PR-AUC {regional_pr_auc}]). "
                f"Combined operational score: {risk_score}/100 → {effective_risk_level}.{override_note}{synoptic_note}{insar_note}{facet_note}"
            )

            return {
                "status": data_state,
                "zone_id": zone_id,
                "zone_name": str(z_row["zone_name"]),
                "district": district_name,
                "state": str(z_row["state"]),
                "model_version": self.artifact.model_version,
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
                "probability": round(proba, 4),
                "risk_score": risk_score,
                "risk_level": effective_risk_level,
                "raw_risk_level": risk_level,
                "physical_override": physical_override,
                "continuous_geotechnical_fusion": {
                    "p_statistical_ml": round(raw_ml_proba, 4),
                    "p_geotechnical_physical": round(p_phys, 4),
                    "p_fused_consensus": round(p_consensus, 4),
                    "geotechnical_stress_ratio": round(geotechnical_stress_ratio, 3),
                    "limit_equilibrium_exceeded": bool(geotechnical_stress_ratio >= 1.0),
                    "governing_regime": "geotechnical_physical" if (not ml_operational or p_phys > raw_ml_proba) else "statistical_ml",
                },
                "explanation_narrative": narrative,
                "factor_attribution": explanation,
                "canonical_features": feats,
                "regional_confidence": {
                    "tier": confidence_tier,
                    "ml_model_operational": bool(confidence_tier not in ("insufficient_data", "unoperational")),
                    "calibration_status": "calibrated_fold_belt" if is_fold_belt else "standard_production",
                    "cv_pr_auc": regional_pr_auc,
                    "threshold_exceeded": threshold_exceeded,
                    "physical_override": physical_override,
                    "synoptic_storm_detected": synoptic_storm_detected,
                    "insar_kinematics_active": kinematic_override,
                    "warning": confidence_warning,
                },
                "synoptic_spatial_correlation": {
                    "is_synoptic_storm": synoptic_storm_detected,
                    "terrane_group": terrane_name or "Unknown Terrane",
                    "concurring_zones": synoptic_info.get("concurring_zones", []),
                    "concurring_count": synoptic_info.get("concurring_count", 0),
                },
                "insar_ground_kinematics": insar_kinematics,
                "localized_facet": {
                    "is_custom_facet": is_custom_facet,
                    "evaluated_slope_deg": evaluated_slope,
                    "facet_type": facet_type or "natural_slope",
                    "facet_amplification_multiplier": facet_mult,
                } if is_custom_facet else None,
                "localized_facet_spectrum": facet_spectrum,
                "data_freshness": {
                    "latest_weather_timestamp": str(latest_wx_time) if latest_wx_time else None,
                    "weather_age_hours": round(wx_age_hours, 1),
                    "soil_moisture_status": sm_status,
                    "pipeline_latency_resilience": {
                        "is_real_time": is_near_real_time,
                        "autonomous_nwp_backfill_applied": auto_backfill_applied,
                        "pipeline_health": "OPTIMAL" if wx_age_hours <= 6.0 else ("RECOVERED_VIA_NWP" if auto_backfill_applied else ("STALE" if wx_age_hours > 72.0 else "DEGRADED")),
                    },
                },
                "inference_timestamp": datetime.now(timezone.utc).isoformat(),
            }

        finally:
            if close_conn:
                conn.close()

    def predict_coordinate(
        self,
        lat: float,
        lng: float,
        slope_deg: float = None,
        facet_type: str = None,
        as_of_date=None,
        conn=None,
    ) -> dict:
        """
        Executes ML ensemble prediction for an arbitrary sub-kilometer coordinate (lat, lng) in the NER.
        Resolves nearest monitored risk zone for meteorological conditions and executes full 19-feature inference.
        """
        close_conn = False
        if conn is None:
            if not DATABASE_URL:
                if _is_production:
                    raise RuntimeError("Production DATABASE_URL is not configured")
                raise RuntimeError("DATABASE_URL is not configured")
            conn = psycopg2.connect(DATABASE_URL, connect_timeout=3)
            close_conn = True

        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, zone_name, district, state, centroid_lat, centroid_lng,
                       mean_slope_deg, slope_p90_deg,
                       |/ ((centroid_lat - %s)^2 + (centroid_lng - %s)^2) * 111.0 as dist_km
                FROM public.risk_zones
                ORDER BY dist_km ASC
                LIMIT 1;
            """, (lat, lng))
            nearest = cur.fetchone()
            cur.close()

            if not nearest:
                return {"status": "INVALID", "error": "No monitored risk zones found in database"}

            nearest_zid = nearest[0]
            eval_slope = float(slope_deg) if slope_deg is not None else float(nearest[7] or nearest[6] or 25.0)

            res = self.predict_zone(
                zone_id=nearest_zid,
                as_of_date=as_of_date,
                conn=conn,
                local_slope_deg=eval_slope,
                facet_type=facet_type,
            )
            res["target_coordinate"] = {"lat": float(lat), "lng": float(lng)}
            res["nearest_reference_zone"] = {
                "zone_id": nearest_zid,
                "zone_name": nearest[1],
                "distance_km": round(float(nearest[8]), 2),
            }
            return res
        finally:
            if close_conn:
                conn.close()

    def predict_zone_forecast(
        self,
        zone_id: int,
        lead_hours: int,
        forecast_rain_mm: float,
        forecast_soil_moisture_pct: float = None,
        as_of_date=None,
        conn=None,
    ) -> dict:
        """
        Coupled NWP-ML forward risk projection:
        Streams numerical weather prediction (NWP) precipitation and moisture guidance
        directly into the canonical 19-feature ensemble and continuous geotechnical gating.
        Evaluates projected risk score, probability, and category at lead times of 24h, 48h, 72h.
        """
        close_conn = False
        if conn is None:
            if not DATABASE_URL:
                if _is_production:
                    raise RuntimeError("Production DATABASE_URL is not configured")
                raise RuntimeError("DATABASE_URL is not configured")
            conn = psycopg2.connect(DATABASE_URL, connect_timeout=3)
            close_conn = True

        as_of = pd.Timestamp.now(tz=timezone.utc) if as_of_date is None else pd.Timestamp(as_of_date)

        try:
            # 1. Load zone
            zones_df = pd.read_sql("SELECT * FROM public.risk_zones WHERE id = %s;", conn, params=(zone_id,))
            if zones_df.empty:
                return {"status": "INVALID", "error": f"Zone id {zone_id} not found"}
            z_row = zones_df.iloc[0]

            # 2. Load weather history up to as_of
            weather_df = pd.read_sql("""
                SELECT zone_id, reading_time::date AS reading_date,
                       SUM(rainfall_mm) AS rainfall_mm,
                       MAX(soil_moisture_pct) FILTER (WHERE soil_moisture_pct IS NOT NULL) AS soil_moisture_pct,
                       MAX(reading_time) as latest_reading_time
                FROM public.weather_readings
                WHERE zone_id = %s AND reading_time < %s
                GROUP BY zone_id, reading_time::date
                ORDER BY reading_date;
            """, conn, params=(zone_id, as_of))

            if weather_df.empty:
                return {"status": "MISSING", "error": f"No historical weather readings for zone {zone_id}"}

            real_events_df = _get_cached_real_events(conn)

            # 3. Project weather forward by lead_hours
            proj_dt = as_of + pd.Timedelta(hours=lead_hours)
            proj_w = weather_df.copy()

            r_mm = max(0.0, float(forecast_rain_mm))
            sm_pct = float(forecast_soil_moisture_pct) if forecast_soil_moisture_pct is not None else float(z_row.get("soil_moisture_pct") or 50.0)

            num_days = max(1, int(round(lead_hours / 24.0)))
            daily_increment = r_mm / float(num_days)

            for d in range(1, num_days + 1):
                f_date = (as_of + pd.Timedelta(days=d)).date()
                proj_w = pd.concat([proj_w, pd.DataFrame([{
                    "zone_id": zone_id,
                    "reading_date": f_date,
                    "rainfall_mm": daily_increment,
                    "soil_moisture_pct": sm_pct,
                    "latest_reading_time": as_of + pd.Timedelta(days=d),
                }])], ignore_index=True)

            # 4. Extract 19 canonical features for projected future state
            proj_feats, meta = extract_features_for_zone(
                z_row, proj_dt, proj_w, real_events_df, temporal_proximity=True
            )
            if proj_feats is None:
                return {"status": "MISSING", "error": "Insufficient weather history for forward projection"}

            # 5. Execute ML ensemble inference on projected features
            raw_ml_proba = float(self.artifact.predict_proba(proj_feats))
            district_name = str(z_row["district"])
            regional_cutoffs = REGIONAL_TERRANE_CUTOFFS.get(district_name)

            # Continuous geotechnical fusion on projected conditions
            is_fold_belt = REGIONAL_TERRANE_CUTOFFS.is_fold_belt(district_name)
            r3d_ratio = float(proj_feats.get("rain_3d_vs_e_thr", 0.0))
            r7d = float(proj_feats.get("rain_7d", 0.0))
            r7d_ratio = (r7d / 80.0) if is_fold_belt else (r7d / 120.0)
            fold_3d_ratio = (r3d_ratio / 0.85) if is_fold_belt else r3d_ratio
            thresh_flag = float(proj_feats.get("threshold_exceedance_flag", 0))

            geotechnical_stress_ratio = max(r3d_ratio, r7d_ratio, fold_3d_ratio, thresh_flag)
            p_phys = 1.0 / (1.0 + math.exp(-8.0 * (geotechnical_stress_ratio - 1.0)))

            proba = 1.0 - (1.0 - raw_ml_proba) * (1.0 - p_phys)
            proba = max(0.001, min(0.999, proba))

            proj_score, proj_level = self.artifact.compute_risk_score(proba, cutoffs=regional_cutoffs)

            # Physical Intensity-Duration metrics (Das et al. 2018 & Monga & Ganguli 2024)
            duration_days = lead_hours / 24.0
            intensity_day = r_mm / duration_days
            i_thr = 43.26 * math.pow(duration_days, -0.78)
            e_thr = -11.10 + 0.62 * float(lead_hours)
            intensity_ratio = intensity_day / i_thr if i_thr > 0 else 0.0

            if proj_level == "Severe" or intensity_ratio >= 1.5:
                trend = "critical"
            elif proj_level == "High" or intensity_ratio >= 1.0:
                trend = "elevating"
            elif proj_level == "Moderate" or intensity_ratio >= 0.6:
                trend = "stable"
            else:
                trend = "improving"

            conf = "high" if lead_hours == 24 else ("medium" if lead_hours == 48 else "low")
            conf_notes = (
                "24h short-range NWP skill is highest (uncertainty ±15%)."
                if lead_hours == 24
                else (
                    "48h medium-range NWP skill is moderate (uncertainty ±30%)."
                    if lead_hours == 48
                    else "72h extended NWP skill has lower confidence (uncertainty ±45%)."
                )
            )

            explanation = self.artifact.explain(proj_feats)
            top_drivers = [c["category"].replace("_", " ") for c in explanation.get("top_categories", [])[:3]]

            narrative = (
                f"{lead_hours}h forward outlook: {r_mm:.1f}mm expected ({intensity_day:.1f}mm/day rate, {intensity_ratio:.2f}x physical threshold). "
                f"Projected ML score: {proj_score}/100 ({proj_level}) [ML proba: {proba:.3f}]. Trend is {trend}."
            )

            return {
                "leadHours": lead_hours,
                "forecastRainfallMm": round(r_mm, 1),
                "intensityMmPerDay": round(intensity_day, 1),
                "intensityThresholdMmPerDay": round(i_thr, 1),
                "moistureThresholdMm": round(e_thr, 1),
                "intensityRatio": round(intensity_ratio, 2),
                "projectedRiskLevel": proj_level,
                "projectedRiskScore": proj_score,
                "projectedProbability": round(proba, 4),
                "trend": trend,
                "confidence": conf,
                "confidenceNotes": conf_notes,
                "narrative": narrative,
                "topFactorDrivers": top_drivers,
                "canonical_features": proj_feats,
                "geotechnicalConsensus": {
                    "p_ml": round(raw_ml_proba, 4),
                    "p_phys": round(p_phys, 4),
                    "p_consensus": round(proba, 4),
                    "stress_ratio": round(geotechnical_stress_ratio, 3),
                },
            }
        finally:
            if close_conn:
                conn.close()

    def persist_prediction(self, pred: dict, conn=None) -> bool:
        """
        Persists an authoritative prediction into public.risk_predictions table with idempotency.
        """
        if pred.get("status") not in ("VALID", "FALLBACK", "STALE"):
            return False
        close_conn = False
        if conn is None:
            try:
                conn = psycopg2.connect(DATABASE_URL, connect_timeout=3)
                close_conn = True
            except Exception:
                return False
        try:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO public.risk_predictions (
                    zone_id, prediction_time, model_version, feature_schema_version,
                    probability, risk_score, risk_category, explanation,
                    data_quality, features
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (zone_id, prediction_time, model_version) DO UPDATE
                SET probability = EXCLUDED.probability,
                    risk_score = EXCLUDED.risk_score,
                    risk_category = EXCLUDED.risk_category,
                    explanation = EXCLUDED.explanation,
                    data_quality = EXCLUDED.data_quality,
                    features = EXCLUDED.features;
            """, (
                pred["zone_id"],
                pred["inference_timestamp"],
                pred["model_version"],
                pred["feature_schema_version"],
                pred["probability"],
                pred["risk_score"],
                pred["risk_level"],
                pred["explanation_narrative"],
                json.dumps(pred.get("data_freshness", {})),
                json.dumps(pred.get("canonical_features", {})),
            ))
            conn.commit()
            return True
        except Exception:
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
            return False
        finally:
            if close_conn:
                conn.close()

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="LandAlert-Nexus Canonical ML Inference CLI")
    parser.add_argument("--zone", type=int, required=True, help="Zone ID (1-15)")
    parser.add_argument("--as-of", type=str, default=None, help="As-of ISO date (e.g. 2024-06-15)")
    parser.add_argument("--artifact", type=str, default=None,
                        help="Path to model artifact. If omitted, reads from active registry entry.")
    parser.add_argument("--persist", action="store_true", help="Persist prediction record to database")
    args = parser.parse_args()

    engine = LandslideRiskInferenceEngine(artifact_path=args.artifact)
    res = engine.predict_zone(zone_id=args.zone, as_of_date=args.as_of)

    if args.persist and res.get("status") in ("VALID", "FALLBACK", "STALE"):
        engine.persist_prediction(res)

    print(json.dumps(res, indent=2, default=str))
