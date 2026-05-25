import io
import json
import logging
import zipfile
from datetime import datetime

from flask import Blueprint, jsonify, request, send_file, session

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
    User,
    db,
)
from ..services.audit import record_audit

logger = logging.getLogger(__name__)

api_bp = Blueprint("api", __name__)

# ── Auth guard ──────────────────────────────────────────────────────────────

_AUTH_EXEMPT = {"/api/auth/login", "/api/auth/me", "/api/auth/logout"}


def _actor() -> str:
    """Return the current session user email for audit attribution."""
    return session.get("user_email", "anonymous")


@api_bp.before_request
def require_auth():
    if request.path not in _AUTH_EXEMPT:
        if not session.get("user_email"):
            return jsonify({"error": "not_authenticated"}), 401


# ── Auth routes ─────────────────────────────────────────────────────────────

@api_bp.post("/auth/login")
def auth_login():
    import bcrypt as _bcrypt
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").encode("utf-8")
    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({"error": "invalid_credentials"}), 401
    pw_hash = user.pw_hash.encode("utf-8") if isinstance(user.pw_hash, str) else user.pw_hash
    if not _bcrypt.checkpw(password, pw_hash):
        return jsonify({"error": "invalid_credentials"}), 401
    session["user_email"] = user.email
    return jsonify({"ok": True, "email": user.email})


@api_bp.post("/auth/logout")
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


@api_bp.get("/auth/me")
def auth_me():
    email = session.get("user_email")
    if not email:
        return jsonify({"error": "not_authenticated"}), 401
    return jsonify({"email": email})


# ── Helper ──────────────────────────────────────────────────────────────────

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


def _requirements_summary(proposal_id: int) -> str:
    reqs = Requirement.query.filter_by(proposal_id=proposal_id, is_deleted=False).all()
    parts = [f"{r.category}: {r.content}" for r in reqs if r.content]
    return "; ".join(parts[:20])  # cap at 20 items for prompt length


def _serialize_requirement(r: Requirement) -> dict:
    return {
        "id": r.id,
        "field_label": r.field_label or r.category,
        "content": r.content,
        "confidence": r.confidence,
        "missing_field_severity": r.missing_field_severity,
        "source_refs": json.loads(r.source_refs or "[]"),
        "is_edited": r.is_edited,
        "is_deleted": r.is_deleted,
        "section_id": r.section_id or r.category,
    }


def _serialize_concept(c: Concept) -> dict:
    return {
        "concept_id": c.id,
        "name": c.name,
        "fit_score": c.fit_score,
        "tags": json.loads(c.tags or "[]"),
        "rationale": c.rationale or c.summary,
        "kb_references": json.loads(c.kb_references or "[]"),
        "status": c.status,
        "rejected_reason": c.rejected_reason,
    }


# ── Proposals ───────────────────────────────────────────────────────────────

@api_bp.get("/proposals")
def list_proposals():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 20, type=int)
    q = request.args.get("q", "").strip()
    query = Proposal.query
    if q:
        query = query.filter(Proposal.title.ilike(f"%{q}%"))
    paginated = query.order_by(Proposal.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    return jsonify({
        "proposals": [
            {
                "id": p.id,
                "title": p.title,
                "status": p.status,
                "current_stage": p.current_stage,
                "created_at": p.created_at.isoformat() + "Z",
                "updated_at": p.updated_at.isoformat() + "Z",
            }
            for p in paginated.items
        ],
        "pagination": {
            "page": paginated.page,
            "per_page": paginated.per_page,
            "total": paginated.total,
            "pages": paginated.pages,
        },
    })


@api_bp.get("/proposals/stats")
def proposals_stats():
    total = Proposal.query.count()
    in_review = Proposal.query.filter(Proposal.current_stage.in_(
        ["requirements_review", "concept_review"]
    )).count()
    approved = Proposal.query.filter(
        Proposal.requirements_approved_at.isnot(None),
        Proposal.concept_approved_at.isnot(None),
    ).count()
    from ..models import ExportPackage
    exported = db.session.query(ExportPackage.proposal_id).distinct().count()
    return jsonify({
        "total": total,
        "in_review": in_review,
        "approved": approved,
        "exported": exported,
    })


@api_bp.post("/proposals")
def create_proposal():
    data = request.get_json(force=True)
    proposal = Proposal(title=data.get("title", "Untitled"), status="draft")
    db.session.add(proposal)
    db.session.commit()
    record_audit("proposal_created", {"title": proposal.title}, proposal.id, actor=_actor())
    return jsonify({
        "id": proposal.id,
        "title": proposal.title,
        "status": proposal.status,
        "current_stage": proposal.current_stage,
        "created_at": proposal.created_at.isoformat() + "Z",
        "updated_at": proposal.updated_at.isoformat() + "Z",
    }), 201


@api_bp.get("/proposals/<int:proposal_id>")
def get_proposal(proposal_id: int):
    p = Proposal.query.get_or_404(proposal_id)
    return jsonify({
        "id": p.id,
        "title": p.title,
        "status": p.status,
        "current_stage": p.current_stage,
        "created_at": p.created_at.isoformat() + "Z",
        "updated_at": p.updated_at.isoformat() + "Z",
    })


# ── Tender intake ───────────────────────────────────────────────────────────

@api_bp.post("/uploads")
def upload_doc():
    if request.content_type and "multipart" in request.content_type:
        f = request.files.get("file")
        raw_pid = request.form.get("proposal_id")
        if not raw_pid:
            return jsonify({"error": "proposal_id required"}), 400
        try:
            proposal_id = int(raw_pid)
        except (ValueError, TypeError):
            return jsonify({"error": "proposal_id must be an integer"}), 400
        Proposal.query.get_or_404(proposal_id)
        filename = f.filename if f else "tender.pdf"
        extracted_text = None
        if f and filename.endswith(".txt"):
            extracted_text = f.read().decode("utf-8", errors="replace")
        doc = TenderDocument(
            proposal_id=proposal_id,
            filename=filename,
            parse_status="queued",
            extracted_text=extracted_text,
        )
    else:
        data = request.get_json(force=True) or {}
        raw_pid = data.get("proposal_id")
        if not raw_pid:
            return jsonify({"error": "proposal_id required"}), 400
        try:
            proposal_id = int(raw_pid)
        except (ValueError, TypeError):
            return jsonify({"error": "proposal_id must be an integer"}), 400
        Proposal.query.get_or_404(proposal_id)
        doc = TenderDocument(
            proposal_id=proposal_id,
            filename=data.get("filename", "tender.pdf"),
            parse_status="queued",
        )
    db.session.add(doc)
    db.session.commit()
    record_audit("document_uploaded", {"document_id": doc.id}, doc.proposal_id, actor=_actor())
    return jsonify({"document_id": doc.id, "parse_status": doc.parse_status}), 201


@api_bp.get("/proposals/<int:proposal_id>/documents")
def list_documents(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    docs = TenderDocument.query.filter_by(proposal_id=proposal_id).order_by(
        TenderDocument.created_at.desc()
    ).all()
    return jsonify([{
        "id": d.id,
        "filename": d.filename,
        "parse_status": d.parse_status,
        "created_at": d.created_at.isoformat() + "Z",
    } for d in docs])


@api_bp.get("/parse-status/<int:document_id>")
def parse_status(document_id: int):
    doc = TenderDocument.query.get_or_404(document_id)
    return jsonify({"document_id": doc.id, "parse_status": doc.parse_status})


@api_bp.post("/proposals/<int:proposal_id>/tender/extract")
def tender_extract(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    doc = TenderDocument.query.filter_by(proposal_id=proposal_id).order_by(
        TenderDocument.created_at.desc()
    ).first()
    if not doc:
        return jsonify({"error": "no_document"}), 404

    doc.parse_status = "parsing"
    db.session.commit()

    try:
        from ..services.llm import extract_tender_requirements
        result = extract_tender_requirements(doc.extracted_text, doc.filename)
        sections_data = result.get("sections", [])
    except Exception as exc:
        logger.error("LLM tender extraction failed: %s — %s", type(exc).__name__, exc)
        # Always create at least one requirement so the workflow isn't stuck.
        # Use extracted text if available; otherwise insert a placeholder.
        placeholder_content = (
            doc.extracted_text[:2000]
            if doc.extracted_text
            else f"[Text extraction unavailable for {doc.filename}. Please enter requirements manually.]"
        )
        fallback_req = Requirement(
            proposal_id=proposal_id,
            category="Tender Summary",
            section_id="tender_summary",
            field_label="Document content",
            content=placeholder_content,
            confidence=0.0,
            missing_field_severity="optional",
            source_refs=json.dumps([]),
        )
        db.session.add(fallback_req)
        doc.parse_status = "complete"
        db.session.commit()
        record_audit("tender_extracted_fallback", {"document_id": doc.id}, proposal_id, actor=_actor())
        return _build_requirements_response(proposal_id)

    # Persist requirements
    for section in sections_data:
        for field in section.get("fields", []):
            req = Requirement(
                proposal_id=proposal_id,
                category=section.get("name", "General"),
                section_id=section.get("section_id", "general"),
                field_label=field.get("field_label", ""),
                content=field.get("content") or "",
                confidence=field.get("confidence", 0.0),
                missing_field_severity=field.get("missing_field_severity", "optional"),
                source_refs=json.dumps(field.get("source_refs", [])),
            )
            db.session.add(req)

    doc.parse_status = "complete"
    db.session.commit()
    record_audit("tender_extracted", {"document_id": doc.id}, proposal_id, actor=_actor())

    # Return same shape as GET /api/proposals/:id/requirements
    return _build_requirements_response(proposal_id)


# ── Requirements ────────────────────────────────────────────────────────────

def _build_requirements_response(proposal_id: int):
    proposal = Proposal.query.get_or_404(proposal_id)
    reqs = Requirement.query.filter_by(proposal_id=proposal_id, is_deleted=False).all()

    # Group by section
    sections_map = {}
    for r in reqs:
        sec_id = r.section_id or r.category
        if sec_id not in sections_map:
            sections_map[sec_id] = {"section_id": sec_id, "name": r.category, "fields": []}
        sections_map[sec_id]["fields"].append(_serialize_requirement(r))

    return jsonify({
        "proposal_id": proposal_id,
        "sections": list(sections_map.values()),
        "approved_by": proposal.requirements_approved_by,
        "approved_at": (
            proposal.requirements_approved_at.isoformat() + "Z"
            if proposal.requirements_approved_at else None
        ),
    })


@api_bp.get("/proposals/<int:proposal_id>/requirements")
def get_requirements(proposal_id: int):
    return _build_requirements_response(proposal_id)


@api_bp.patch("/requirements/<int:req_id>")
def edit_requirement(req_id: int):
    req = Requirement.query.get_or_404(req_id)
    data = request.get_json(force=True)
    req.content = data.get("content", req.content)
    req.is_edited = True
    db.session.commit()
    record_audit("requirement_edited", {"requirement_id": req.id}, req.proposal_id, actor=_actor())
    return jsonify(_serialize_requirement(req))


@api_bp.delete("/requirements/<int:req_id>")
def delete_requirement(req_id: int):
    req = Requirement.query.get_or_404(req_id)
    req.is_deleted = True
    db.session.commit()
    record_audit("requirement_deleted", {"requirement_id": req.id}, req.proposal_id, actor=_actor())
    return jsonify({"deleted": True, "id": req.id})


@api_bp.post("/requirements/<int:req_id>/restore")
def restore_requirement(req_id: int):
    req = Requirement.query.get_or_404(req_id)
    req.is_deleted = False
    db.session.commit()
    record_audit("requirement_restored", {"requirement_id": req.id}, req.proposal_id, actor=_actor())
    return jsonify(_serialize_requirement(req))


@api_bp.post("/proposals/<int:proposal_id>/requirements/approve")
def approve_requirements(proposal_id: int):
    proposal = Proposal.query.get_or_404(proposal_id)
    reqs = Requirement.query.filter_by(proposal_id=proposal_id, is_deleted=False).all()

    # Check required fields
    missing_required = [
        r for r in reqs
        if r.missing_field_severity == "required" and not r.content
    ]
    if missing_required:
        return jsonify({"error": "missing_required_fields", "count": len(missing_required)}), 409

    user_email = session.get("user_email", "demo@elitez.local")
    proposal.requirements_approved_by = user_email
    proposal.requirements_approved_at = datetime.utcnow()
    proposal.current_stage = "concept_selection"
    db.session.commit()
    record_audit("requirements_approved", {"proposal_id": proposal_id}, proposal_id, actor=_actor())
    return jsonify({
        "approved_by": proposal.requirements_approved_by,
        "approved_at": proposal.requirements_approved_at.isoformat() + "Z",
        "current_stage": proposal.current_stage,
    })


# ── Concepts ────────────────────────────────────────────────────────────────

@api_bp.get("/proposals/<int:proposal_id>/concepts")
def get_concepts(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    concepts = Concept.query.filter_by(proposal_id=proposal_id).all()
    return jsonify({
        "proposal_id": proposal_id,
        "concepts": [_serialize_concept(c) for c in concepts],
    })


@api_bp.post("/concepts/generate")
def generate_concepts():
    data = request.get_json(force=True)
    proposal_id = data["proposal_id"]
    proposal = Proposal.query.get_or_404(proposal_id)
    guidance = data.get("guidance", "")
    regenerate = data.get("regenerate", False)

    req_summary = _requirements_summary(proposal_id)

    try:
        from ..services.llm import generate_concepts as llm_generate
        raw_concepts = llm_generate(proposal.title, req_summary)
    except Exception as exc:
        logger.error("LLM concept generation failed: %s — %s", type(exc).__name__, exc)
        return jsonify({"error": "llm_concepts_failed", "detail": type(exc).__name__}), 502

    # If regenerating, mark existing concepts as archived (don't delete for history)
    if regenerate:
        existing = Concept.query.filter_by(proposal_id=proposal_id).all()
        for c in existing:
            c.status = "archived"

    saved = []
    for rc in raw_concepts:
        concept = Concept(
            proposal_id=proposal_id,
            name=rc.get("name", "Unnamed"),
            summary=rc.get("rationale", ""),
            fit_score=rc.get("fit_score", 0.5),
            tags=json.dumps(rc.get("tags", [])),
            rationale=rc.get("rationale", ""),
            kb_references=json.dumps(rc.get("kb_references", [])),
            status="available",
        )
        db.session.add(concept)
        saved.append(concept)

    db.session.commit()
    record_audit(
        "concepts_generated",
        {"proposal_id": proposal_id, "count": len(saved)},
        proposal_id,
        actor=_actor(),
    )

    return jsonify({
        "concepts": [_serialize_concept(c) for c in saved]
    }), 201


@api_bp.patch("/concepts/<int:concept_id>")
def patch_concept(concept_id: int):
    concept = Concept.query.get_or_404(concept_id)
    data = request.get_json(force=True)
    if "status" in data:
        concept.status = data["status"]
    if "rejected_reason" in data:
        concept.rejected_reason = data["rejected_reason"]
    db.session.commit()
    record_audit("concept_patched", {"concept_id": concept.id}, concept.proposal_id, actor=_actor())
    return jsonify(_serialize_concept(concept))


@api_bp.post("/proposals/<int:proposal_id>/concepts/approve")
def approve_concept(proposal_id: int):
    proposal = Proposal.query.get_or_404(proposal_id)
    data = request.get_json(force=True)
    concept_id = data.get("concept_id")
    concept = Concept.query.filter_by(id=concept_id, proposal_id=proposal_id).first()
    if not concept:
        return jsonify({"error": "concept_not_found"}), 404

    concept.status = "selected"
    user_email = session.get("user_email", "demo@elitez.local")
    proposal.concept_approved_by = user_email
    proposal.concept_approved_at = datetime.utcnow()
    proposal.current_stage = "costing_builder"
    db.session.commit()
    record_audit("concept_approved", {"concept_id": concept_id}, proposal_id, actor=_actor())
    return jsonify({
        "approved_by": proposal.concept_approved_by,
        "approved_at": proposal.concept_approved_at.isoformat() + "Z",
        "current_stage": proposal.current_stage,
    })


# ── Costing ─────────────────────────────────────────────────────────────────

@api_bp.get("/proposals/<int:proposal_id>/costing/items")
def get_costing_items(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    items = CostingItem.query.filter_by(proposal_id=proposal_id).all()
    return jsonify({
        "proposal_id": proposal_id,
        "items": [
            {
                "item_id": item.id,
                "item_name": item.item_name,
                "quantity": item.quantity,
                "unit_cost": item.unit_cost,
                "status": item.status,
                "line_total": round(item.quantity * item.unit_cost, 2),
            }
            for item in items
        ],
        "summary": _costing_rollup(proposal_id),
    })


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
    record_audit("costing_item_added", {"item_id": item.id}, item.proposal_id, actor=_actor())
    return jsonify({"item_id": item.id}), 201


@api_bp.patch("/costing/items/<int:item_id>")
def patch_costing_item(item_id: int):
    item = CostingItem.query.get_or_404(item_id)
    data = request.get_json(force=True)
    item.quantity = data.get("quantity", item.quantity)
    item.unit_cost = data.get("unit_cost", item.unit_cost)
    item.status = data.get("status", item.status)
    db.session.commit()
    record_audit("costing_item_updated", {"item_id": item.id}, item.proposal_id, actor=_actor())
    return jsonify({
        "item_id": item.id,
        "quantity": item.quantity,
        "unit_cost": item.unit_cost,
        "status": item.status,
        "line_total": round(item.quantity * item.unit_cost, 2),
    })


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
    record_audit("costing_item_duplicated", {"item_id": duplicate.id}, item.proposal_id, actor=_actor())
    return jsonify({"item_id": duplicate.id}), 201


@api_bp.delete("/costing/items/<int:item_id>")
def delete_costing_item(item_id: int):
    item = CostingItem.query.get_or_404(item_id)
    proposal_id = item.proposal_id
    db.session.delete(item)
    db.session.commit()
    record_audit("costing_item_deleted", {"item_id": item_id}, proposal_id, actor=_actor())
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
        summary=json.dumps(rollup),
    )
    db.session.add(version)
    db.session.commit()
    record_audit("costing_version_created", {"version_id": version.id}, proposal_id, actor=_actor())
    return jsonify({
        "version_id": version.id,
        "version_label": version.version_label,
        "subtotal": rollup["subtotal"],
        "item_count": rollup["item_count"],
        "missing_count": rollup["missing_count"],
    }), 201


@api_bp.get("/proposals/<int:proposal_id>/costing/version-history")
def get_costing_versions(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    versions = (
        CostingVersion.query.filter_by(proposal_id=proposal_id)
        .order_by(CostingVersion.created_at.desc())
        .all()
    )
    return jsonify([
        {
            "version_id": v.id,
            "version_label": v.version_label,
            "summary": v.summary,
        }
        for v in versions
    ])


# ── Studio slides ───────────────────────────────────────────────────────────

@api_bp.get("/proposals/<int:proposal_id>/studio/slides")
def get_studio_slides(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    slides = (
        StudioSlide.query.filter_by(proposal_id=proposal_id)
        .order_by(StudioSlide.position)
        .all()
    )
    return jsonify({
        "proposal_id": proposal_id,
        "slides": [
            {
                "slide_id": s.id,
                "title": s.title,
                "content": s.content,
                "position": s.position,
                "status": s.status,
            }
            for s in slides
        ],
    })


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
    record_audit("studio_slide_created", {"slide_id": slide.id}, proposal_id, actor=_actor())
    return jsonify({"slide_id": slide.id, "position": slide.position}), 201


@api_bp.patch("/studio/slides/<int:slide_id>/reorder")
def reorder_studio_slide(slide_id: int):
    slide = StudioSlide.query.get_or_404(slide_id)
    data = request.get_json(force=True)
    new_pos = int(data.get("position", slide.position))

    # Load all slides ordered by current position, remove target, reinsert at new position
    all_slides = (
        StudioSlide.query.filter_by(proposal_id=slide.proposal_id)
        .order_by(StudioSlide.position)
        .all()
    )
    others = [s for s in all_slides if s.id != slide.id]
    new_pos = max(1, min(new_pos, len(all_slides)))
    others.insert(new_pos - 1, slide)
    for i, s in enumerate(others, start=1):
        s.position = i
    db.session.commit()
    record_audit("studio_slide_reordered", {"slide_id": slide.id}, slide.proposal_id, actor=_actor())
    return jsonify({"slide_id": slide.id, "position": slide.position})


@api_bp.post("/studio/slides/<int:slide_id>/regenerate")
def regenerate_studio_slide(slide_id: int):
    slide = StudioSlide.query.get_or_404(slide_id)
    data = request.get_json(silent=True) or {}
    guidance = data.get("guidance", "")

    proposal = Proposal.query.get(slide.proposal_id)
    req_summary = _requirements_summary(slide.proposal_id) if proposal else ""

    try:
        from ..services.llm import regenerate_slide as llm_regen
        new_content = llm_regen(
            slide_title=slide.title,
            current_content=slide.content,
            proposal_title=proposal.title if proposal else "",
            requirements_summary=req_summary,
            guidance=guidance,
        )
        slide.content = new_content
        slide.status = "ready"
        db.session.commit()
        record_audit("studio_slide_regenerated", {"slide_id": slide.id}, slide.proposal_id, actor=_actor())
        return jsonify({"slide_id": slide.id, "status": slide.status, "content": slide.content})
    except Exception as exc:
        logger.error("LLM slide regeneration failed: %s — %s", type(exc).__name__, exc)
        return jsonify({"slide_id": slide.id, "status": "error", "content": None, "detail": type(exc).__name__}), 502


# ── Export & Approvals ──────────────────────────────────────────────────────

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
    record_audit("export_draft_created", {"draft_id": draft.id}, proposal_id, actor=_actor())
    return jsonify({"draft_id": draft.id, "state": draft.state}), 201


@api_bp.get("/proposals/<int:proposal_id>/exports/drafts")
def list_export_drafts(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    rollup = _costing_rollup(proposal_id)
    proposal_approvals = Approval.query.filter_by(proposal_id=proposal_id).all()
    drafts = (
        ExportDraft.query.filter_by(proposal_id=proposal_id)
        .order_by(ExportDraft.created_at.desc())
        .all()
    )
    has_approval = len(proposal_approvals) > 0 and all(
        a.decision == "approved" for a in proposal_approvals
    )
    return jsonify({
        "gate_checks": [
            {"label": "Costing complete", "pass": rollup["is_complete"]},
            {"label": "Manager approval obtained", "pass": has_approval},
        ],
        "drafts": [
            {
                "id": d.id,
                "parent_version": d.parent_version,
                "artifact_type": d.artifact_type,
                "state": d.state,
                "package_id": (
                    ExportPackage.query.filter_by(proposal_id=proposal_id)
                    .order_by(ExportPackage.created_at.desc())
                    .first() or type("_", (), {"id": None})()
                ).id if d.state == "archived" else None,
            }
            for d in drafts
        ],
        "approvals": [
            {"approver": a.approver, "decision": a.decision}
            for a in proposal_approvals
        ],
    })


@api_bp.post("/exports/drafts/<int:draft_id>/promote")
def promote_export_draft(draft_id: int):
    draft = ExportDraft.query.get_or_404(draft_id)
    draft.state = "archived"
    export = ExportPackage(proposal_id=draft.proposal_id, status="ready")
    db.session.add(export)
    db.session.commit()
    record_audit("export_draft_promoted", {"draft_id": draft.id, "export_id": export.id}, draft.proposal_id, actor=_actor())
    return jsonify({"export_id": export.id, "status": export.status})


@api_bp.get("/exports/packages/<int:package_id>/download")
def download_export_package(package_id: int):
    pkg = ExportPackage.query.get_or_404(package_id)
    proposal = Proposal.query.get_or_404(pkg.proposal_id)
    slides = (
        StudioSlide.query.filter_by(proposal_id=proposal.id)
        .order_by(StudioSlide.position)
        .all()
    )
    items = CostingItem.query.filter_by(proposal_id=proposal.id).all()
    concepts = Concept.query.filter_by(proposal_id=proposal.id).all()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "proposal_id": proposal.id,
            "title": proposal.title,
            "status": proposal.status,
            "exported_at": datetime.utcnow().isoformat() + "Z",
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

        slides_data = [{"position": s.position, "title": s.title, "content": s.content} for s in slides]
        zf.writestr("slides.json", json.dumps(slides_data, indent=2))

        costing_data = [
            {"item_name": i.item_name, "quantity": i.quantity, "unit_cost": i.unit_cost,
             "line_total": round(i.quantity * i.unit_cost, 2)} for i in items
        ]
        zf.writestr("costing.json", json.dumps(costing_data, indent=2))

        concepts_data = [
            {"name": c.name, "status": c.status, "rationale": c.rationale, "fit_score": c.fit_score}
            for c in concepts
        ]
        zf.writestr("concepts.json", json.dumps(concepts_data, indent=2))

    buf.seek(0)
    record_audit("export_downloaded", {"package_id": package_id}, proposal.id, actor=_actor())
    return send_file(
        buf,
        as_attachment=True,
        download_name=f"proposal-{proposal.id}-export.zip",
        mimetype="application/zip",
    )


@api_bp.get("/proposals/<int:proposal_id>/exports/download.zip")
def download_proposal_zip(proposal_id: int):
    pkg = (
        ExportPackage.query.filter_by(proposal_id=proposal_id)
        .order_by(ExportPackage.created_at.desc())
        .first()
    )
    if not pkg:
        return jsonify({"error": "no_export_package"}), 404
    return download_export_package(pkg.id)


@api_bp.get("/proposals/<int:proposal_id>/exports/packages/latest/download")
def download_latest_export(proposal_id: int):
    pkg = (
        ExportPackage.query.filter_by(proposal_id=proposal_id)
        .order_by(ExportPackage.created_at.desc())
        .first()
    )
    if not pkg:
        return jsonify({"error": "no_export_package"}), 404
    return download_export_package(pkg.id)


@api_bp.post("/exports/packages")
def create_export_package():
    data = request.get_json(force=True)
    export = ExportPackage(proposal_id=data["proposal_id"], status="ready")
    db.session.add(export)
    db.session.commit()
    record_audit("export_created", {"export_id": export.id}, export.proposal_id, actor=_actor())
    return jsonify({"export_id": export.id, "status": export.status}), 201


@api_bp.post("/approvals")
def create_approval():
    data = request.get_json(force=True)
    user_email = session.get("user_email", "demo@elitez.local")
    approval = Approval(
        proposal_id=data["proposal_id"],
        approver=data.get("approver", user_email),
        decision="pending",
    )
    db.session.add(approval)
    db.session.commit()
    record_audit("approval_created", {"approval_id": approval.id}, approval.proposal_id, actor=_actor())
    return jsonify({
        "approval_id": approval.id,
        "decision": approval.decision,
        "approver": approval.approver,
    }), 201


@api_bp.patch("/approvals/<int:approval_id>")
def update_approval(approval_id: int):
    approval = Approval.query.get_or_404(approval_id)
    data = request.get_json(force=True)
    approval.decision = data.get("decision", approval.decision)
    db.session.commit()
    record_audit("approval_updated", {"approval_id": approval.id, "decision": approval.decision}, approval.proposal_id, actor=_actor())
    return jsonify({"approval_id": approval.id, "decision": approval.decision})


# ── Admin ───────────────────────────────────────────────────────────────────

@api_bp.get("/admin/pricing")
def list_pricing():
    items = PricingCatalogItem.query.order_by(PricingCatalogItem.item_name).all()
    return jsonify({
        "items": [
            {
                "id": item.id,
                "item_name": item.item_name,
                "unit": item.unit,
                "current_price": item.current_price,
                "is_stale": item.is_stale,
                "has_variance_warning": item.has_variance_warning,
            }
            for item in items
        ]
    })


@api_bp.patch("/admin/pricing/<int:item_id>")
def patch_pricing_item(item_id: int):
    item = PricingCatalogItem.query.get_or_404(item_id)
    data = request.get_json(force=True)
    if "current_price" in data:
        item.current_price = float(data["current_price"])
    if "item_name" in data:
        item.item_name = data["item_name"]
    if "unit" in data:
        item.unit = data["unit"]
    if "is_stale" in data:
        item.is_stale = bool(data["is_stale"])
    if "has_variance_warning" in data:
        item.has_variance_warning = bool(data["has_variance_warning"])
    db.session.commit()
    record_audit("pricing_catalog_item_updated", {"pricing_item_id": item.id}, actor=_actor())
    return jsonify({
        "id": item.id,
        "item_name": item.item_name,
        "unit": item.unit,
        "current_price": item.current_price,
        "is_stale": item.is_stale,
        "has_variance_warning": item.has_variance_warning,
    })


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
    record_audit("pricing_catalog_item_created", {"pricing_item_id": item.id}, actor=_actor())
    return jsonify({"pricing_item_id": item.id}), 201


@api_bp.post("/admin/pricing/<int:item_id>/refresh")
def refresh_pricing_item(item_id: int):
    item = PricingCatalogItem.query.get_or_404(item_id)
    item.is_stale = False
    db.session.commit()
    record_audit("pricing_catalog_item_refreshed", {"pricing_item_id": item.id}, actor=_actor())
    return jsonify({"pricing_item_id": item.id, "is_stale": item.is_stale})


@api_bp.post("/admin/pricing/publish")
def publish_pricing_catalog():
    return jsonify({"status": "published", "asset_count": PricingCatalogItem.query.count()})


@api_bp.get("/admin/assets")
def list_assets():
    assets = TemplateAsset.query.order_by(TemplateAsset.created_at.desc()).all()
    return jsonify([{
        "id": a.id,
        "asset_type": a.asset_type,
        "title": a.title,
        "is_duplicate_candidate": a.is_duplicate_candidate,
        "is_stale": a.is_stale,
        "is_active": a.is_active,
    } for a in assets])


@api_bp.post("/admin/assets")
def create_asset():
    data = request.get_json(force=True)
    asset = TemplateAsset(asset_type=data["asset_type"], title=data["title"])
    db.session.add(asset)
    db.session.commit()
    record_audit("asset_created", {"asset_id": asset.id}, actor=_actor())
    return jsonify({"asset_id": asset.id}), 201


@api_bp.patch("/admin/assets/<int:asset_id>")
def patch_asset(asset_id: int):
    asset = TemplateAsset.query.get_or_404(asset_id)
    data = request.get_json(force=True)
    asset.is_duplicate_candidate = data.get("is_duplicate_candidate", asset.is_duplicate_candidate)
    asset.is_stale = data.get("is_stale", asset.is_stale)
    db.session.commit()
    record_audit("asset_governance_updated", {"asset_id": asset.id}, actor=_actor())
    return jsonify({
        "asset_id": asset.id,
        "is_duplicate_candidate": asset.is_duplicate_candidate,
        "is_stale": asset.is_stale,
    })


@api_bp.post("/admin/assets/<int:asset_id>/publish")
def publish_template_asset(asset_id: int):
    asset = TemplateAsset.query.get_or_404(asset_id)
    asset.is_stale = False
    db.session.commit()
    record_audit("asset_published", {"asset_id": asset.id}, actor=_actor())
    return jsonify({"asset_id": asset.id, "published": True})


@api_bp.post("/admin/assets/<int:asset_id>/duplicate-check")
def duplicate_asset_check(asset_id: int):
    asset = TemplateAsset.query.get_or_404(asset_id)
    asset.is_duplicate_candidate = False
    db.session.commit()
    record_audit("asset_duplicate_checked", {"asset_id": asset.id}, actor=_actor())
    return jsonify({"asset_id": asset.id, "is_duplicate_candidate": asset.is_duplicate_candidate})


@api_bp.post("/admin/assets/<int:asset_id>/toggle-active")
def toggle_asset_active(asset_id: int):
    asset = TemplateAsset.query.get_or_404(asset_id)
    action = request.get_json(silent=True) or {}
    asset.is_active = action.get("is_active", not asset.is_active)
    db.session.commit()
    record_audit("asset_active_toggled", {"asset_id": asset.id, "is_active": asset.is_active}, actor=_actor())
    return jsonify({"asset_id": asset.id, "is_active": asset.is_active})


@api_bp.get("/admin/governance/summary")
def governance_summary():
    stale_pricing = PricingCatalogItem.query.filter_by(is_stale=True).count()
    variance_pricing = PricingCatalogItem.query.filter_by(has_variance_warning=True).count()
    duplicate_assets = TemplateAsset.query.filter_by(is_duplicate_candidate=True).count()
    stale_assets = TemplateAsset.query.filter_by(is_stale=True).count()
    return jsonify({
        "pricing": {
            "stale_count": stale_pricing,
            "variance_warning_count": variance_pricing,
        },
        "assets": {
            "duplicate_candidate_count": duplicate_assets,
            "stale_count": stale_assets,
        },
    })


# ── Misc legacy / audit ─────────────────────────────────────────────────────

@api_bp.post("/proposals/<int:proposal_id>/generate")
def generate_proposal(proposal_id: int):
    Proposal.query.get_or_404(proposal_id)
    record_audit("proposal_generated", {"proposal_id": proposal_id}, proposal_id, actor=_actor())
    return jsonify({"proposal_id": proposal_id, "status": "generated"})


@api_bp.post("/concepts/<int:concept_id>/retry")
def retry_concept(concept_id: int):
    concept = Concept.query.get_or_404(concept_id)
    concept.summary = "Regenerated concept summary"
    db.session.commit()
    record_audit("concept_regenerated", {"concept_id": concept.id}, concept.proposal_id, actor=_actor())
    return jsonify({"concept_id": concept.id, "summary": concept.summary})


@api_bp.get("/audit")
def get_audit():
    from ..models import AuditEvent
    events = AuditEvent.query.order_by(AuditEvent.created_at.desc()).limit(100).all()
    return jsonify([
        {
            "id": e.id,
            "proposal_id": e.proposal_id,
            "event_type": e.event_type,
            "details": e.details,
        }
        for e in events
    ])
