from flask import Blueprint, jsonify, request

from ..models import (
    Approval,
    Concept,
    CostingItem,
    ExportDraft,
    ExportPackage,
    CostingVersion,
    PricingCatalogItem,
    Proposal,
    Requirement,
    StudioSlide,
    TemplateAsset,
    TenderDocument,
    db,
)
from ..services.audit import record_audit

api_bp = Blueprint("api", __name__)


def _costing_rollup(proposal_id: int) -> dict:
    items = CostingItem.query.filter_by(proposal_id=proposal_id).all()
    subtotal = sum(item.quantity * item.unit_cost for item in items)
    missing_count = sum(
        1 for item in items if item.status == "needs_price" or item.unit_cost <= 0
    )
    return {
        "item_count": len(items),
        "subtotal": round(subtotal, 2),
        "missing_count": missing_count,
        "is_complete": missing_count == 0 and len(items) > 0,
    }


@api_bp.post("/proposals")
def create_proposal():
    data = request.get_json(force=True)
    proposal = Proposal(title=data.get("title", "Untitled"), status="draft")
    db.session.add(proposal)
    db.session.commit()
    record_audit("proposal_created", {"title": proposal.title}, proposal.id)
    return jsonify({"id": proposal.id, "status": proposal.status}), 201


@api_bp.post("/uploads")
def upload_doc():
    data = request.get_json(force=True)
    doc = TenderDocument(
        proposal_id=data["proposal_id"],
        filename=data.get("filename", "tender.pdf"),
        parse_status="queued",
    )
    db.session.add(doc)
    db.session.commit()
    record_audit("document_uploaded", {"document_id": doc.id}, doc.proposal_id)
    return jsonify({"document_id": doc.id, "parse_status": doc.parse_status}), 201


@api_bp.get("/parse-status/<int:document_id>")
def parse_status(document_id: int):
    doc = TenderDocument.query.get_or_404(document_id)
    return jsonify({"document_id": doc.id, "parse_status": doc.parse_status})


@api_bp.patch("/requirements/<int:req_id>")
def edit_requirement(req_id: int):
    req = Requirement.query.get_or_404(req_id)
    data = request.get_json(force=True)
    req.content = data.get("content", req.content)
    db.session.commit()
    record_audit("requirement_edited", {"requirement_id": req.id}, req.proposal_id)
    return jsonify({"id": req.id, "content": req.content})


@api_bp.post("/concepts/generate")
def generate_concepts():
    data = request.get_json(force=True)
    concept = Concept(
        proposal_id=data["proposal_id"],
        name="AI Concept",
        summary="Generated concept summary",
    )
    db.session.add(concept)
    db.session.commit()
    record_audit("concept_generated", {"concept_id": concept.id}, concept.proposal_id)
    return jsonify({"concept_id": concept.id}), 201


@api_bp.post("/concepts/<int:concept_id>/retry")
def retry_concept(concept_id: int):
    concept = Concept.query.get_or_404(concept_id)
    concept.summary = "Regenerated concept summary"
    db.session.commit()
    record_audit("concept_regenerated", {"concept_id": concept.id}, concept.proposal_id)
    return jsonify({"concept_id": concept.id, "summary": concept.summary})


@api_bp.post("/costing/items")
def upsert_costing_item():
    data = request.get_json(force=True)
    item = CostingItem(
        proposal_id=data["proposal_id"],
        item_name=data["item_name"],
        quantity=data.get("quantity", 1),
        unit_cost=data.get("unit_cost", 0.0),
        status=data.get("status", "priced"),
    )
    db.session.add(item)
    db.session.commit()
    record_audit("costing_item_added", {"item_id": item.id}, item.proposal_id)
    return jsonify({"item_id": item.id}), 201


@api_bp.patch("/costing/items/<int:item_id>")
def patch_costing_item(item_id: int):
    item = CostingItem.query.get_or_404(item_id)
    data = request.get_json(force=True)
    item.quantity = data.get("quantity", item.quantity)
    item.unit_cost = data.get("unit_cost", item.unit_cost)
    item.status = data.get("status", item.status)
    db.session.commit()
    record_audit("costing_item_updated", {"item_id": item.id}, item.proposal_id)
    return jsonify(
        {
            "item_id": item.id,
            "quantity": item.quantity,
            "unit_cost": item.unit_cost,
            "status": item.status,
        }
    )


@api_bp.post("/costing/items/<int:item_id>/duplicate")
def duplicate_costing_item(item_id: int):
    item = CostingItem.query.get_or_404(item_id)
    duplicate = CostingItem(
        proposal_id=item.proposal_id,
        item_name=item.item_name,
        quantity=item.quantity,
        unit_cost=item.unit_cost,
        status=item.status,
    )
    db.session.add(duplicate)
    db.session.commit()
    record_audit("costing_item_duplicated", {"item_id": duplicate.id}, item.proposal_id)
    return jsonify({"item_id": duplicate.id}), 201


@api_bp.delete("/costing/items/<int:item_id>")
def delete_costing_item(item_id: int):
    item = CostingItem.query.get_or_404(item_id)
    proposal_id = item.proposal_id
    db.session.delete(item)
    db.session.commit()
    record_audit("costing_item_deleted", {"item_id": item.id}, proposal_id)
    return jsonify({"deleted": True}), 200


@api_bp.get("/proposals/<int:proposal_id>/costing/summary")
def get_costing_summary(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    return jsonify(_costing_rollup(proposal_id))


@api_bp.post("/proposals/<int:proposal_id>/costing/version")
def snapshot_costing_version(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    version_count = CostingVersion.query.filter_by(proposal_id=proposal_id).count() + 1
    rollup = _costing_rollup(proposal_id)
    version = CostingVersion(
        proposal_id=proposal_id,
        version_label=f"v{version_count}",
        summary=str(rollup),
    )
    db.session.add(version)
    db.session.commit()
    record_audit(
        "costing_version_created", {"version_id": version.id}, version.proposal_id
    )
    return jsonify({"version_id": version.id, "version_label": version.version_label}), 201


@api_bp.get("/proposals/<int:proposal_id>/costing/version-history")
def get_costing_versions(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    versions = (
        CostingVersion.query.filter_by(proposal_id=proposal_id)
        .order_by(CostingVersion.created_at.desc())
        .all()
    )
    return jsonify(
        [
            {
                "version_id": version.id,
                "version_label": version.version_label,
                "summary": version.summary,
            }
            for version in versions
        ]
    )


@api_bp.post("/proposals/<int:proposal_id>/generate")
def generate_proposal(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    record_audit("proposal_generated", {"proposal_id": proposal_id}, proposal_id)
    return jsonify({"proposal_id": proposal_id, "status": "generated"})


@api_bp.post("/exports/packages")
def create_export_package():
    data = request.get_json(force=True)
    export = ExportPackage(proposal_id=data["proposal_id"], status="ready")
    db.session.add(export)
    db.session.commit()
    record_audit("export_created", {"export_id": export.id}, export.proposal_id)
    return jsonify({"export_id": export.id, "status": export.status}), 201


@api_bp.post("/proposals/<int:proposal_id>/exports/drafts")
def create_export_draft(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    rollup = _costing_rollup(proposal_id)
    approvals = Approval.query.filter_by(proposal_id=proposal_id).all()
    has_gate = len(approvals) > 0 and all(a.decision == "approved" for a in approvals)
    if not rollup["is_complete"]:
        return jsonify({"error": "costing_incomplete", "summary": rollup}), 409
    if not has_gate:
        return jsonify({"error": "approvals_incomplete"}), 409

    data = request.get_json(silent=True) or {}
    draft = ExportDraft(
        proposal_id=proposal_id,
        parent_version=data.get("parent_version", "v1"),
        artifact_type=data.get("artifact_type", "PDF+Deck"),
        state="staged",
    )
    db.session.add(draft)
    db.session.commit()
    record_audit("export_draft_created", {"draft_id": draft.id}, proposal_id)
    return jsonify({"draft_id": draft.id, "state": draft.state}), 201


@api_bp.get("/proposals/<int:proposal_id>/exports/drafts")
def list_export_drafts(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    drafts = (
        ExportDraft.query.filter_by(proposal_id=proposal_id)
        .order_by(ExportDraft.created_at.desc())
        .all()
    )
    return jsonify(
        [
            {
                "draft_id": draft.id,
                "parent_version": draft.parent_version,
                "artifact_type": draft.artifact_type,
                "state": draft.state,
            }
            for draft in drafts
        ]
    )


@api_bp.post("/exports/drafts/<int:draft_id>/promote")
def promote_export_draft(draft_id: int):
    draft = ExportDraft.query.get_or_404(draft_id)
    draft.state = "archived"
    export = ExportPackage(proposal_id=draft.proposal_id, status="ready")
    db.session.add(export)
    db.session.commit()
    record_audit(
        "export_draft_promoted",
        {"draft_id": draft.id, "export_id": export.id},
        draft.proposal_id,
    )
    return jsonify({"export_id": export.id, "status": export.status})


@api_bp.post("/admin/assets")
def create_asset():
    data = request.get_json(force=True)
    asset = TemplateAsset(asset_type=data["asset_type"], title=data["title"])
    db.session.add(asset)
    db.session.commit()
    record_audit("asset_created", {"asset_id": asset.id})
    return jsonify({"asset_id": asset.id}), 201


@api_bp.patch("/admin/assets/<int:asset_id>")
def patch_asset(asset_id: int):
    asset = TemplateAsset.query.get_or_404(asset_id)
    data = request.get_json(force=True)
    asset.is_duplicate_candidate = data.get(
        "is_duplicate_candidate", asset.is_duplicate_candidate
    )
    asset.is_stale = data.get("is_stale", asset.is_stale)
    db.session.commit()
    record_audit("asset_governance_updated", {"asset_id": asset.id})
    return jsonify(
        {
            "asset_id": asset.id,
            "is_duplicate_candidate": asset.is_duplicate_candidate,
            "is_stale": asset.is_stale,
        }
    )


@api_bp.post("/admin/pricing")
def create_pricing_item():
    data = request.get_json(force=True)
    item = PricingCatalogItem(
        item_name=data["item_name"],
        unit=data.get("unit", "unit"),
        current_price=data.get("current_price", 0.0),
        is_stale=data.get("is_stale", False),
        has_variance_warning=data.get("has_variance_warning", False),
    )
    db.session.add(item)
    db.session.commit()
    record_audit("pricing_catalog_item_created", {"pricing_item_id": item.id})
    return jsonify({"pricing_item_id": item.id}), 201


@api_bp.post("/admin/pricing/<int:item_id>/refresh")
def refresh_pricing_item(item_id: int):
    item = PricingCatalogItem.query.get_or_404(item_id)
    item.is_stale = False
    db.session.commit()
    record_audit("pricing_catalog_item_refreshed", {"pricing_item_id": item.id})
    return jsonify({"pricing_item_id": item.id, "is_stale": item.is_stale})


@api_bp.post("/admin/pricing/publish")
def publish_pricing_catalog():
    return jsonify({"status": "published", "asset_count": PricingCatalogItem.query.count()})


@api_bp.post("/admin/assets/<int:asset_id>/publish")
def publish_template_asset(asset_id: int):
    asset = TemplateAsset.query.get_or_404(asset_id)
    asset.is_stale = False
    db.session.commit()
    record_audit("asset_published", {"asset_id": asset.id})
    return jsonify({"asset_id": asset.id, "published": True})


@api_bp.post("/admin/assets/<int:asset_id>/duplicate-check")
def duplicate_asset_check(asset_id: int):
    asset = TemplateAsset.query.get_or_404(asset_id)
    asset.is_duplicate_candidate = False
    db.session.commit()
    record_audit("asset_duplicate_checked", {"asset_id": asset.id})
    return jsonify({"asset_id": asset.id, "is_duplicate_candidate": asset.is_duplicate_candidate})


@api_bp.post("/admin/assets/<int:asset_id>/toggle-active")
def toggle_asset_active(asset_id: int):
    asset = TemplateAsset.query.get_or_404(asset_id)
    action = request.get_json(silent=True) or {}
    asset.is_active = action.get("is_active", not asset.is_active)
    db.session.commit()
    record_audit("asset_active_toggled", {"asset_id": asset.id, "is_active": asset.is_active})
    return jsonify({"asset_id": asset.id, "is_active": asset.is_active})


@api_bp.get("/admin/governance/summary")
def governance_summary():
    stale_pricing = PricingCatalogItem.query.filter_by(is_stale=True).count()
    variance_pricing = PricingCatalogItem.query.filter_by(has_variance_warning=True).count()
    duplicate_assets = TemplateAsset.query.filter_by(is_duplicate_candidate=True).count()
    stale_assets = TemplateAsset.query.filter_by(is_stale=True).count()
    return jsonify(
        {
            "pricing": {
                "stale_count": stale_pricing,
                "variance_warning_count": variance_pricing,
            },
            "assets": {
                "duplicate_candidate_count": duplicate_assets,
                "stale_count": stale_assets,
            },
        }
    )


@api_bp.post("/proposals/<int:proposal_id>/studio/slides")
def create_studio_slide(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    data = request.get_json(force=True)
    current_count = StudioSlide.query.filter_by(proposal_id=proposal_id).count()
    slide = StudioSlide(
        proposal_id=proposal_id,
        title=data.get("title", "Untitled Slide"),
        content=data.get("content", ""),
        position=current_count + 1,
        status="ai_drafted",
    )
    db.session.add(slide)
    db.session.commit()
    record_audit("studio_slide_created", {"slide_id": slide.id}, proposal_id)
    return jsonify({"slide_id": slide.id, "position": slide.position}), 201


@api_bp.patch("/studio/slides/<int:slide_id>/reorder")
def reorder_studio_slide(slide_id: int):
    slide = StudioSlide.query.get_or_404(slide_id)
    data = request.get_json(force=True)
    slide.position = data.get("position", slide.position)
    db.session.commit()
    record_audit("studio_slide_reordered", {"slide_id": slide.id}, slide.proposal_id)
    return jsonify({"slide_id": slide.id, "position": slide.position})


@api_bp.post("/studio/slides/<int:slide_id>/regenerate")
def regenerate_studio_slide(slide_id: int):
    slide = StudioSlide.query.get_or_404(slide_id)
    data = request.get_json(silent=True) or {}
    guidance = data.get("guidance", "")
    slide.content = f"Regenerated content{': ' + guidance if guidance else ''}"
    slide.status = "ready"
    db.session.commit()
    record_audit("studio_slide_regenerated", {"slide_id": slide.id}, slide.proposal_id)
    return jsonify({"slide_id": slide.id, "status": slide.status, "content": slide.content})


@api_bp.get("/audit")
def get_audit():
    from ..models import AuditEvent

    events = AuditEvent.query.order_by(AuditEvent.created_at.desc()).limit(100).all()
    return jsonify(
        [
            {
                "id": e.id,
                "proposal_id": e.proposal_id,
                "event_type": e.event_type,
                "details": e.details,
            }
            for e in events
        ]
    )


@api_bp.post("/approvals")
def create_approval():
    data = request.get_json(force=True)
    approval = Approval(
        proposal_id=data["proposal_id"],
        approver=data.get("approver", "manager@elitez.local"),
        decision="pending",
    )
    db.session.add(approval)
    db.session.commit()
    record_audit("approval_created", {"approval_id": approval.id}, approval.proposal_id)
    return jsonify({"approval_id": approval.id, "decision": approval.decision}), 201


@api_bp.patch("/approvals/<int:approval_id>")
def update_approval(approval_id: int):
    approval = Approval.query.get_or_404(approval_id)
    data = request.get_json(force=True)
    approval.decision = data.get("decision", approval.decision)
    db.session.commit()
    record_audit(
        "approval_updated",
        {"approval_id": approval.id, "decision": approval.decision},
        approval.proposal_id,
    )
    return jsonify({"approval_id": approval.id, "decision": approval.decision})
