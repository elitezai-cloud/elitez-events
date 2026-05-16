# Elitez Proposal UI Shell

Static frontend scaffold for ELIA UI workflow implementation.

## Includes

- Persistent eight-stage workflow rail
- Proposal dashboard surface
- Interactive stage tabs for:
  - Dashboard
  - Tender Intake
  - Requirement Review
  - Concept Selection
  - Costing Builder
  - Proposal Studio
  - Review & Export
  - Admin Governance
- Tender intake surface with metadata form, document upload state, parse progress, and missing-budget signal
- Requirement review workspace with editable fields, confidence/missing markers, source traceability, and approve action
- Concept selection workspace with 1-3 concept cards, fit tags, KB references, regenerate guidance, and approval state
- Costing builder surface with line-item editor, totals, markup/margin, and missing-price flags
- Proposal studio surface with slide rail, preview canvas, and regenerate/reorder controls
- Review and export surface with readiness checklist, approval gate, and export history
- Admin governance surface with pricing catalog, KB assets, templates, and governance signals
- Review/export versioning with draft lineage and promote/compare actions
- Responsive behavior for desktop/mobile
- Source evidence drawer, audit/version trail, async retry states, and deployment/QA status surfaced in relevant stages.

## Run

Open `index.html` in a browser.

## Production-style Run Steps

1. `cd ui-shell`
2. Open `index.html` with a local static server (optional but recommended):
   - `python -m http.server 8080`
   - open `http://localhost:8080`

To capture the required screenshots:

1. Open each workflow stage in sequence.
2. Capture viewport and state at each checkpoint (desktop 1440x900, mobile 390x844 recommended).
3. Save into `ui-shell/screenshots/`.

## Local Screenshot Checkpoints

- `/ui-shell/screenshots/01-proposal-dashboard.png`
- `/ui-shell/screenshots/02-tender-intake.png`
- `/ui-shell/screenshots/03-requirement-review.png`
- `/ui-shell/screenshots/04-concept-selection.png`
- `/ui-shell/screenshots/05-costing-builder.png`
- `/ui-shell/screenshots/06-proposal-studio.png`
- `/ui-shell/screenshots/07-review-export.png`
- `/ui-shell/screenshots/08-admin-governance.png`

Capture order should follow the flow: Dashboard → Intake → Requirements → Concept → Costing → Studio → Export → Admin.

## Preview Deployment (No Secrets)

GitHub Actions workflow: `.github/workflows/elitez-events-preview.yml`

- Trigger: push to `main` with changes under `ui-shell/**` (or manual dispatch).
- Auth: uses built-in `GITHUB_TOKEN` only (no repository secrets required).
- Hosting: GitHub Pages deployment artifact from `ui-shell/`.

Preview URL format after first successful run:

- `https://elitez-chrysler.github.io/cv-reformater/`
