import pytest

from app import create_app
from app.models import Requirement, db


@pytest.fixture()
def client():
    app = create_app()
    app.config.update(SQLALCHEMY_DATABASE_URI="sqlite:///:memory:", TESTING=True)
    with app.app_context():
        db.drop_all()
        db.create_all()
    test_client = app.test_client()
    test_client.app_ref = app
    return test_client


def _audit_event_types(client):
    resp = client.get("/api/audit")
    assert resp.status_code == 200
    return [row["event_type"] for row in resp.get_json()]


def test_health_route(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"ok": True}


def test_full_elitezevents_workflow_routes_and_state(client):
    proposal = client.post("/api/proposals", json={"title": "Demo"}).get_json()
    proposal_id = proposal["id"]
    assert proposal["status"] == "draft"

    upload = client.post(
        "/api/uploads", json={"proposal_id": proposal_id, "filename": "x.pdf"}
    )
    assert upload.status_code == 201
    upload_payload = upload.get_json()
    document_id = upload_payload["document_id"]
    assert upload_payload["parse_status"] == "queued"

    parse = client.get(f"/api/parse-status/{document_id}")
    assert parse.status_code == 200
    assert parse.get_json()["parse_status"] == "queued"

    concept = client.post("/api/concepts/generate", json={"proposal_id": proposal_id})
    assert concept.status_code == 201
    concept_id = concept.get_json()["concept_id"]

    retry = client.post(f"/api/concepts/{concept_id}/retry")
    assert retry.status_code == 200
    assert retry.get_json()["summary"] == "Regenerated concept summary"

    costing = client.post(
        "/api/costing/items",
        json={
            "proposal_id": proposal_id,
            "item_name": "LED Wall",
            "quantity": 2,
            "unit_cost": 4850,
        },
    )
    assert costing.status_code == 201
    assert costing.get_json()["item_id"] > 0

    proposal_generate = client.post(f"/api/proposals/{proposal_id}/generate")
    assert proposal_generate.status_code == 200
    assert proposal_generate.get_json()["status"] == "generated"

    export = client.post("/api/exports/packages", json={"proposal_id": proposal_id})
    assert export.status_code == 201
    assert export.get_json()["status"] == "ready"

    asset = client.post(
        "/api/admin/assets", json={"asset_type": "playbook", "title": "Broadcast Pack"}
    )
    assert asset.status_code == 201
    assert asset.get_json()["asset_id"] > 0

    approval = client.post("/api/approvals", json={"proposal_id": proposal_id})
    assert approval.status_code == 201
    assert approval.get_json()["decision"] == "pending"

    event_types = _audit_event_types(client)
    assert "proposal_created" in event_types
    assert "document_uploaded" in event_types
    assert "concept_generated" in event_types
    assert "concept_regenerated" in event_types
    assert "costing_item_added" in event_types
    assert "proposal_generated" in event_types
    assert "export_created" in event_types
    assert "asset_created" in event_types
    assert "approval_created" in event_types


def test_requirement_edit_updates_state_and_audit(client):
    proposal_id = client.post("/api/proposals", json={"title": "Requirements"}).get_json()["id"]
    with client.app_ref.app_context():
        req = Requirement(
            proposal_id=proposal_id, category="technical", content="Old requirement"
        )
        db.session.add(req)
        db.session.commit()
        req_id = req.id

    edit = client.patch(f"/api/requirements/{req_id}", json={"content": "Updated requirement"})
    assert edit.status_code == 200
    assert edit.get_json()["content"] == "Updated requirement"
    assert "requirement_edited" in _audit_event_types(client)


def test_not_found_for_async_resource_states(client):
    parse = client.get("/api/parse-status/999999")
    assert parse.status_code == 404

    retry = client.post("/api/concepts/999999/retry")
    assert retry.status_code == 404


def test_production_controls_costing_studio_export_admin(client):
    proposal_id = client.post("/api/proposals", json={"title": "Controls"}).get_json()["id"]

    priced_line = client.post(
        "/api/costing/items",
        json={
            "proposal_id": proposal_id,
            "item_name": "LED Wall",
            "quantity": 2,
            "unit_cost": 4850,
            "status": "priced",
        },
    )
    assert priced_line.status_code == 201

    unpriced_line = client.post(
        "/api/costing/items",
        json={
            "proposal_id": proposal_id,
            "item_name": "Talent Rider Add-ons",
            "quantity": 1,
            "unit_cost": 0,
            "status": "needs_price",
        },
    )
    assert unpriced_line.status_code == 201
    unpriced_item_id = unpriced_line.get_json()["item_id"]

    summary = client.get(f"/api/proposals/{proposal_id}/costing/summary")
    assert summary.status_code == 200
    assert summary.get_json()["is_complete"] is False
    assert summary.get_json()["missing_count"] == 1

    blocked = client.post(f"/api/proposals/{proposal_id}/exports/drafts", json={})
    assert blocked.status_code == 409
    assert blocked.get_json()["error"] == "costing_incomplete"

    pricing_fix = client.patch(
        f"/api/costing/items/{unpriced_item_id}",
        json={"unit_cost": 3300, "status": "priced"},
    )
    assert pricing_fix.status_code == 200
    assert pricing_fix.get_json()["status"] == "priced"

    approval = client.post("/api/approvals", json={"proposal_id": proposal_id, "approver": "finance"})
    approval_id = approval.get_json()["approval_id"]
    approval_update = client.patch(f"/api/approvals/{approval_id}", json={"decision": "approved"})
    assert approval_update.status_code == 200
    assert approval_update.get_json()["decision"] == "approved"

    draft = client.post(
        f"/api/proposals/{proposal_id}/exports/drafts",
        json={"parent_version": "v1.8.4", "artifact_type": "PDF+Deck+CSV"},
    )
    assert draft.status_code == 201
    draft_id = draft.get_json()["draft_id"]

    drafts = client.get(f"/api/proposals/{proposal_id}/exports/drafts")
    assert drafts.status_code == 200
    assert len(drafts.get_json()) == 1

    promoted = client.post(f"/api/exports/drafts/{draft_id}/promote")
    assert promoted.status_code == 200
    assert promoted.get_json()["status"] == "ready"

    slide = client.post(
        f"/api/proposals/{proposal_id}/studio/slides",
        json={"title": "Event Vision", "content": "Draft"},
    )
    assert slide.status_code == 201
    slide_id = slide.get_json()["slide_id"]

    reorder = client.patch(f"/api/studio/slides/{slide_id}/reorder", json={"position": 3})
    assert reorder.status_code == 200
    assert reorder.get_json()["position"] == 3

    regen = client.post(
        f"/api/studio/slides/{slide_id}/regenerate",
        json={"guidance": "Reduce scenic complexity by 20%"},
    )
    assert regen.status_code == 200
    assert regen.get_json()["status"] == "ready"

    asset = client.post(
        "/api/admin/assets",
        json={"asset_type": "playbook", "title": "Broadcast Pack"},
    )
    asset_id = asset.get_json()["asset_id"]
    asset_update = client.patch(
        f"/api/admin/assets/{asset_id}",
        json={"is_duplicate_candidate": True, "is_stale": True},
    )
    assert asset_update.status_code == 200
    assert asset_update.get_json()["is_duplicate_candidate"] is True

    pricing_item = client.post(
        "/api/admin/pricing",
        json={
            "item_name": "Registration App",
            "unit": "license",
            "current_price": 1900,
            "is_stale": True,
            "has_variance_warning": True,
        },
    )
    pricing_item_id = pricing_item.get_json()["pricing_item_id"]
    refresh = client.post(f"/api/admin/pricing/{pricing_item_id}/refresh")
    assert refresh.status_code == 200
    assert refresh.get_json()["is_stale"] is False

    governance = client.get("/api/admin/governance/summary")
    assert governance.status_code == 200
    payload = governance.get_json()
    assert payload["assets"]["duplicate_candidate_count"] == 1
    assert payload["pricing"]["variance_warning_count"] == 1
