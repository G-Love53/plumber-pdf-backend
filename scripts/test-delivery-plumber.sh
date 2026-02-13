#!/usr/bin/env bash
# Plumber segment — test delivery and printing
# Sends PLUMBER_INTAKE bundle (SUPP_CONTRACTOR + ACORD125/126/130/140) to segment quote email
# formData keys aligned with CID_HomeBase/templates/SUPP_CONTRACTOR/mapping/page-1.map.json (and ACORD)
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
    "premise_city": "Denver",
    "premise_state": "CO",
    "premise_zip": "80202",
    "physical_address_1": "789 Service Rd",
    "physical_city_1": "Denver",
    "physical_state": "CO",
    "physical_zip": "80202",
    "organization_type": "LLC",
    "business_type": "LLC",
    "business_phone": "555-000-0002",
    "business_website": "https://testplumber.example.com",
    "contact_email": "test@example.com",
    "effective_date": "2025-02-13",
    "policy_effective_date": "2025-02-13",
    "square_footage": "3000",
    "num_employees": "8",
    "years_in_business": "5",
    "years_experience": "10",
    "projected_gross_revenue": "500000",
    "agency_name": "Commercial Insurance Direct LLC",
    "producer_name": "CID Plumber",
    "producer_phone": "303-932-1700"
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
