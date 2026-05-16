# ELIA-128 Visual Pack for ELIA-121

Generated on 2026-05-15 using built-in `image_gen` (ui-mockup prompts).

## Assets

1. `01-proposal-dashboard.png` — Proposal Dashboard (project list, statuses, blockers, activity, filters)
2. `02-tender-intake.png` — New Proposal / Tender Intake (metadata, upload, parsing, detected summary)
3. `03-requirement-review.png` — Requirement Review (editable sections, confidence, missing fields, traceability)
4. `04-concept-selection.png` — Concept Selection (3 concept cards, guidance regeneration, approval state)
5. `05-costing-builder.png` — Costing Builder (line-item editor, totals/markup/margin, missing-price flags, versioning)
6. `06-proposal-studio.png` — Proposal Studio (slide rail, preview canvas, regenerate + reorder controls)
7. `07-review-export.png` — Review & Export (checklist, approval gate, package summary, export history)
8. `08-admin-governance.png` — Admin Governance (pricing catalog, KB assets, templates, governance signals)

## Route / State Mapping

| Product route/state | Visual file | Coverage notes |
| --- | --- | --- |
| `/proposals` | `01-proposal-dashboard.png` | Proposal overview, proposal status, blockers, activity, filters, quick-create entry point |
| `/proposals/new` | `02-tender-intake.png` | Intake metadata, upload state, parsing progress, detected brief summary, missing-budget signal |
| `/proposals/:id/requirements` | `03-requirement-review.png` | AI extraction review, editable requirement sections, confidence markers, missing fields, source traceability |
| `/proposals/:id/concepts` | `04-concept-selection.png` | Three concept recommendations, fit tags, KB references, regeneration guidance, concept approval |
| `/proposals/:id/costing` | `05-costing-builder.png` | Line-item costing editor, totals, markup, margin, missing-price flags, costing version state |
| `/proposals/:id/studio` | `06-proposal-studio.png` | Slide outline rail, preview canvas, static/dynamic slide split, section regenerate/reorder controls |
| `/proposals/:id/export` | `07-review-export.png` | Review checklist, export readiness, approval gate, package summary, export history |
| `/admin` | `08-admin-governance.png` | Pricing catalog, knowledge-base assets, template governance, stale/duplicate/inactive signals |

## Production State Coverage

| Required production surface | Visual coverage |
| --- | --- |
| Proposal dashboard | `01-proposal-dashboard.png` |
| Admin/governance | `08-admin-governance.png` |
| Source evidence drawer | `03-requirement-review.png` traceability/source panel |
| Audit/version history | `05-costing-builder.png` version state and `07-review-export.png` export history |
| Async error/retry states | `02-tender-intake.png` parsing/upload state and `07-review-export.png` blocked export readiness |
| Deployment/QA status surface | `07-review-export.png` readiness/package status surface |

## Usage

- Primary consumer: ELIA-121 full visual presentation pack.
- Source theme: approved ELIA design direction (Apple-like restraint + Bevel-style information density).
- Format: PNG mockups plus this index, intended for design review and implementation reference.
