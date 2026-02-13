# Plumber test — step-by-step (ACORD125 + SUPP_CONTRACTOR, etc.)

Get all 5 PDFs (Supplemental + ACORD125/126/130/140) rendering and emailed so they print as nicely as ACORD125.

## Prereqs

- **Layout:** `CID_HomeBase` must be a **sibling** of `plumber-pdf-backend` (same parent folder).  
  Example: `GitHub/plumber-pdf-backend` and `GitHub/CID_HomeBase`.
- **Node:** 20+.
- **Env (for email):** In `plumber-pdf-backend` create `.env` with Gmail credentials if you want real delivery (see README). For “just render” you can skip email and use `/render-bundle` (see below).

---

## Option 1 — Local server + test script (recommended)

**Terminal 1 — start server**

```bash
cd /Users/newmacminim4/GitHub/plumber-pdf-backend
npm install
npm start
```

Wait for: `PDF service listening on 8080` (or whatever PORT).

**Terminal 2 — hit submit-quote (generates PDFs and emails)**

```bash
cd /Users/newmacminim4/GitHub/plumber-pdf-backend
BASE_URL=http://localhost:8080  TO=quotes@plumberinsurancedirect.com  bash scripts/test-delivery-plumber.sh
```

- If `.env` has Gmail set: check inbox at `TO` for the 5 PDFs.
- If not: you may get 200 but no email; then use Option 2 to get PDFs in the response.

**If port 8080 is in use**

```bash
PORT=3000 npm start
# then:
BASE_URL=http://localhost:3000  bash scripts/test-delivery-plumber.sh
```

---

## Option 2 — Get PDFs in response (no email)

Same server as above, then:

```bash
curl -s -X POST http://localhost:8080/render-bundle \
  -H "Content-Type: application/json" \
  -d '{
    "bundle_id": "PLUMBER_INTAKE",
    "formData": {
      "applicant_name": "Test Plumber Ops",
      "insured_name": "Test Plumber Ops",
      "physical_address_1": "789 Service Rd",
      "physical_city_1": "Denver",
      "physical_state": "CO",
      "physical_zip": "80202",
      "agency_name": "Commercial Insurance Direct LLC",
      "producer_name": "CID Plumber",
      "producer_phone": "303-932-1700",
      "business_phone": "555-000-0002",
      "policy_effective_date": "2025-02-13",
      "organization_type": "LLC",
      "business_type": "LLC",
      "years_in_business": "5",
      "years_experience": "10"
    }
  }' --output plumber-bundle.pdf
```

Open `plumber-bundle.pdf` — it will be the **first** form (Supplemental-Application.pdf). To get all 5 PDFs and confirm they print like ACORD125, use Option 1 (submit-quote) and check your inbox.

---

## Option 2b — Open just SUPP_CONTRACTOR + ACORD125 (no intake change)

Intake stays as-is (all 5). These two curls generate only the two forms you want to open. Server must be running on 8080.

**Supplemental (SUPP_CONTRACTOR) only:**
```bash
curl -s -X POST http://localhost:8080/render-bundle \
  -H "Content-Type: application/json" \
  -d '{
    "templates": [
      { "name": "SUPP_CONTRACTOR", "data": {
        "applicant_name": "Test",
        "insured_name": "Test",
        "physical_address_1": "123 Main",
        "physical_city_1": "Denver",
        "physical_state": "CO",
        "physical_zip": "80202",
        "agency_name": "CID",
        "producer_name": "CID",
        "policy_effective_date": "2025-02-13"
      }}
    ]
  }' --output Supplemental.pdf && open Supplemental.pdf
```

**ACORD125 only:**
```bash
curl -s -X POST http://localhost:8080/render-bundle \
  -H "Content-Type: application/json" \
  -d '{
    "templates": [
      { "name": "ACORD125", "data": {
        "applicant_name": "Test",
        "insured_name": "Test",
        "physical_address_1": "123 Main",
        "physical_city_1": "Denver",
        "physical_state": "CO",
        "physical_zip": "80202",
        "agency_name": "CID",
        "producer_name": "CID",
        "policy_effective_date": "2025-02-13"
      }}
    ]
  }' --output ACORD125.pdf && open ACORD125.pdf
```

Run both to open the two PDFs. No change to `PLUMBER_INTAKE` or bundles.

---

## Option 3 — Test against Render (no local server)

If your Render service already has access to `CID_HomeBase` (e.g. monorepo or linked build):

```bash
cd /Users/newmacminim4/GitHub/plumber-pdf-backend
bash scripts/test-delivery-plumber.sh
```

Uses default `BASE_URL=https://plumber-pdf-backend.onrender.com` and `TO=quotes@plumberinsurancedirect.com`. Check that inbox for the 5 PDFs.

---

## Quick copy-paste (local, with email)

```bash
# Terminal 1
cd /Users/newmacminim4/GitHub/plumber-pdf-backend && npm start

# Terminal 2 (after "listening on 8080")
cd /Users/newmacminim4/GitHub/plumber-pdf-backend && BASE_URL=http://localhost:8080 bash scripts/test-delivery-plumber.sh
```

Then check the inbox for the delivery; open the PDFs and print to confirm they match the quality you see with ACORD125.
