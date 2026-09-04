#!/usr/bin/env bash
# =====================================================================
# Master Test & Verification Runner for Landslide Early Warning ML Layer
# (SIH26001 / landalert-nexus)
# =====================================================================
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$DIR"

echo "================================================================="
echo "  LANDALERT-NEXUS: RUNNING ALL ML & PRODUCTION TESTS"
echo "================================================================="

echo ""
echo ">>> [1/6] Running TypeScript / Vitest Unit Tests..."
npm test

echo ""
echo ">>> [2/6] Running ML Leakage & Hygiene Regression Suite..."
python3 scripts/test_ml_leakage.py

echo ""
echo ">>> [3/6] Running Comprehensive Python ML Production Suite..."
pytest tests/test_ml_production_suite.py -q

echo ""
echo ">>> [4/6] Running Data Pipeline Validation (Positives, GLOF, Weather)..."
python3 scripts/validate_data_pipeline.py

echo ""
echo ">>> [5/6] Auditing Model Registry..."
python3 scripts/ml_registry.py list

echo ""
echo ">>> [6/6] Running Production ML & Data Quality Monitoring..."
python3 scripts/ml_monitor.py

echo ""
echo "================================================================="
echo "  ✓ ALL ML TESTS & VERIFICATION CHECKS PASSED SUCCESSFULLY!"
echo "================================================================="
