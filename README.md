# plumber-pdf-backend (Plumber segment)

**CID Leg 2 — Plumber segment.** Renders ACORD + supplemental PDFs from CID_HomeBase templates (Plumber uses SUPP_CONTRACTOR), emails via Gmail API. Same RSS pattern as Bar and Roofer.

* **Segment:** `plumber` (set via `SEGMENT` env; default `plumber`).
* **Canonical bundle:** `PLUMBER_INTAKE` = SUPP_CONTRACTOR + ACORD125, 126, 130, 140. Config in `src/config/bundles.json`.
* **Templates:** CID_HomeBase submodule. No local template duplication.

Deploy: Docker (Render). Build clones CID_HomeBase when submodules are not available.
