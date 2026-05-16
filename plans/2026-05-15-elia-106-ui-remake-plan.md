# ELIA-106 UI Remake Plan

Date: 2026-05-15
Issue: ELIA-106
Project: ElitezEvents
Status: Approved for execution

## Objective

Align the Elitez AI Proposal System UI around the TRD's actual operator workflow before implementation starts. The product is an internal proposal assistant, not a marketing site and not an autonomous agent. The UI should feel premium and calm, but it must primarily help sales and proposal staff move through review gates with speed and confidence.

## Product Positioning

- Build for internal operators who need throughput, traceability, and confidence.
- Optimize for "reviewable AI output" rather than magic automation.
- Keep the UI minimal, but never ambiguous about what is draft, generated, edited, approved, or blocked.

## Visual Direction

Primary direction:
- Apple-style restraint: oversized clear headings, disciplined spacing, quiet chrome, strong hierarchy.
- Bevel-style information density: clean metric cards, focused dashboards, and device-quality polish.

Guardrails:
- Do not overdo glassmorphism. Use frosted panels as accents for overlays, drawers, and hero moments, not as the entire UI treatment.
- Avoid a generic SaaS dashboard look. The shell should feel editorial and high-trust.
- Use one strong neutral base, one accent color, and one approval-state system instead of rainbow UI.
- Motion should communicate state transitions and progress through the workflow, not decorative noise.

## UX Thesis

The system should revolve around a single proposal project workspace with a persistent workflow rail:

1. Tender Intake
2. Requirement Review
3. Concept Selection
4. Costing Builder
5. Proposal Studio
6. Review & Export

Every stage should answer three questions immediately:
- What has the AI done?
- What still needs human review?
- What is blocking export?

## Core Screens

### 1. Proposal Dashboard

Purpose:
- Show all proposal projects and their stage, owner, urgency, and blockers.

Must include:
- stage/status chips
- latest activity
- blocker state
- quick-create new proposal
- filters for draft, review, approved, exported

### 2. New Proposal / Tender Intake

Purpose:
- Start a proposal project and upload the tender/spec.

Must include:
- event metadata form
- drag-and-drop upload
- parsing status
- detected document summary
- missing-budget signal

### 3. Requirement Review Workspace

Purpose:
- Turn raw extraction into trusted structured requirements.

Must include:
- editable requirement sections
- confidence markers
- missing-field callouts
- source-reference drawer back to uploaded document text
- explicit approve-and-continue action

### 4. Concept Selection Workspace

Purpose:
- Compare concept directions and approve one for costing.

Must include:
- 1-3 concept cards
- rationale and fit tags
- linked knowledge-base references
- regenerate with guidance
- concept approval state

### 5. Costing Builder

Purpose:
- Convert approved scope into editable commercial logic.

Must include:
- line-item editor
- totals, markup, margin, and bid summary
- missing-price flags
- manual override support
- costing version history

### 6. Proposal Studio

Purpose:
- Assemble the client deck from approved inputs.

Must include:
- slide outline rail
- preview canvas
- section regenerate controls
- reorder/remove controls
- clear split between static brand slides and dynamic generated slides

### 7. Review & Export

Purpose:
- Enforce final readiness before files leave the system.

Must include:
- completion checklist
- export package summary
- approval gate status
- export history and file access
- reasons export is blocked

### 8. Admin Surfaces

Purpose:
- Maintain the assets that power the workflow.

Must include:
- pricing catalog manager
- knowledge-base asset library
- template manager
- tag/governance fields

## Missing UI Surfaces Not Explicitly Spelled Out In The TRD

These are necessary for a usable product even if they are only implied by the TRD:

1. Global workflow rail and per-stage progress state.
2. Evidence/source drawer for traceability from AI output back to tender text.
3. Async job states for parse, generate, export, retry, and failure recovery.
4. Approval-gate handoff UI between salesperson and proposal manager.
5. Version history for costing, concept revisions, and proposal deck revisions.
6. Activity/audit timeline at the proposal-project level.
7. Empty/loading/error states for every AI-dependent screen.
8. Export history with file metadata and latest approved package.
9. Knowledge-base influence display so users can see why the system suggested a concept or item.
10. Admin governance patterns for duplicate assets, stale pricing, and inactive templates.

## Recommended Build Order

Phase 1:
- establish design tokens, typography, shell layout, navigation, and workflow rail
- build Proposal Dashboard and New Proposal

Phase 2:
- build Requirement Review with traceability drawer and edit states
- build Concept Selection with approval flow

Phase 3:
- build Costing Builder and Review & Export checklist

Phase 4:
- build Proposal Studio preview and export surfaces
- build Admin surfaces

## Delivery Rule

Start implementation with the shell and core workflow screens first. Do not spend early cycles on high-fidelity marketing polish, advanced glass effects, or admin depth before the operator path is coherent.

## FE Delegation Plan After Approval

Founding Engineer should receive follow-up work in this order:

1. Scaffold the app shell, design tokens, navigation, and workflow rail.
2. Implement the intake and requirement-review path.
3. Implement costing, proposal studio, and review/export flows.

## Execution Breakdown

- [ELIA-108](/ELIA/issues/ELIA-108): Build the Elitez proposal UI shell, design system, dashboard, and workflow rail.
- [ELIA-109](/ELIA/issues/ELIA-109): Implement intake, requirement review, and concept selection workflows.
- [ELIA-110](/ELIA/issues/ELIA-110): Implement costing builder, proposal studio, and review/export workflow.
- [ELIA-111](/ELIA/issues/ELIA-111): Implement admin surfaces for pricing, knowledge-base assets, and template governance.

## Visual Concept Prompt

If a concept image is generated later, use GPT image generation only. Prompt direction:

"Design a premium internal web app dashboard for an AI proposal assistant used by an events company. Visual style: Apple-like restraint, soft glass accents, editorial typography, warm neutral palette, clean proposal workflow rail, elegant metric cards inspired by modern health dashboards, high whitespace, sharp hierarchy, no generic SaaS look. Show proposal dashboard plus workflow status for intake, requirement review, concept selection, costing, proposal studio, and export readiness."
