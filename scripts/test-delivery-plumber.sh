#!/usr/bin/env bash
# Plumber segment — test delivery and printing
# Sends PLUMBER_INTAKE bundle (SUPP_CONTRACTOR + ACORD125/126/130/140) to segment quote email
# Usage: ./scripts/test-delivery-plumber.sh   (or set BASE_URL if different)

set -e
BASE_URL="${BASE_URL:-https://plumber-pdf-backend.onrender.com}"
TO="${TO:-quotes@plumberinsurancedirect.com}"

echo "Plumber test delivery: POST $BASE_URL/submit-quote → $TO"
echo ""

RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/submit-quote" \
  -H "Content-Type: application/json" \
  -d '{
  "bundle_id": "PLUMBER_INTAKE",
  "formData": {
    "applicant_name": "Test Plumber Ops",
    "insured_name": "Test Plumber Ops",
    "premises_name": "Test Plumber LLC",
    "premise_address": "789 Service Rd",
    "organization_type": "LLC",
    "business_phone": "555-000-0002",
    "contact_email": "test@example.com",
    "effective_date": "2025-02-13",
    "square_footage": "3000",
    "num_employees": "8"
  },
  "email": {
    "to": ["'"$TO"'"],
    "subject": "CID Plumber — Ops test delivery"
  }
}')

HTTP_BODY=$(echo "$RESP" | head -n -1)
HTTP_CODE=$(echo "$RESP" | tail -n 1)

echo "HTTP $HTTP_CODE"
echo "$HTTP_BODY" | jq -r '.' 2>/dev/null || echo "$HTTP_BODY"

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  echo ""
  echo "OK — Check inbox: $TO (subject: CID Plumber — Ops test delivery)"
else
  echo ""
  echo "Request failed (HTTP $HTTP_CODE). Check body above."
  exit 1
fi
