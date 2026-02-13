#!/usr/bin/env bash
# Generate and open only SUPP_CONTRACTOR + ACORD125 (no intake change).
# Usage: ./scripts/test-two-pdfs.sh   (server must be on http://localhost:8080)

set -e
BASE="${BASE_URL:-http://localhost:8080}"

echo "Fetching Supplemental (SUPP_CONTRACTOR)..."
curl -s -X POST "$BASE/render-bundle" -H "Content-Type: application/json" \
  -d '{"templates":[{"name":"SUPP_CONTRACTOR","data":{"applicant_name":"Test","insured_name":"Test","physical_address_1":"123 Main","physical_city_1":"Denver","physical_state":"CO","physical_zip":"80202","agency_name":"CID","producer_name":"CID","policy_effective_date":"2025-02-13"}}]}' \
  --output Supplemental.pdf

echo "Fetching ACORD125..."
curl -s -X POST "$BASE/render-bundle" -H "Content-Type: application/json" \
  -d '{"templates":[{"name":"ACORD125","data":{"applicant_name":"Test","insured_name":"Test","physical_address_1":"123 Main","physical_city_1":"Denver","physical_state":"CO","physical_zip":"80202","agency_name":"CID","producer_name":"CID","policy_effective_date":"2025-02-13"}}]}' \
  --output ACORD125.pdf

echo "Opening both..."
open Supplemental.pdf ACORD125.pdf
