from datetime import datetime

from flask_sqlalchemy import SQLAlchemy


db = SQLAlchemy()


class TimestampMixin:
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class Proposal(db.Model, TimestampMixin):
    __tablename__ = "proposals"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(32), nullable=False, default="draft")


class TenderDocument(db.Model, TimestampMixin):
    __tablename__ = "tender_documents"
    id = db.Column(db.Integer, primary_key=True)
    proposal_id = db.Column(db.Integer, db.ForeignKey("proposals.id"), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    parse_status = db.Column(db.String(32), nullable=False, default="queued")


class Requirement(db.Model, TimestampMixin):
    __tablename__ = "requirements"
    id = db.Column(db.Integer, primary_key=True)
    proposal_id = db.Column(db.Integer, db.ForeignKey("proposals.id"), nullable=False)
    category = db.Column(db.String(64), nullable=False)
    content = db.Column(db.Text, nullable=False)


class Concept(db.Model, TimestampMixin):
    __tablename__ = "concepts"
    id = db.Column(db.Integer, primary_key=True)
    proposal_id = db.Column(db.Integer, db.ForeignKey("proposals.id"), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    summary = db.Column(db.Text, nullable=False)


class CostingItem(db.Model, TimestampMixin):
    __tablename__ = "costing_items"
    id = db.Column(db.Integer, primary_key=True)
    proposal_id = db.Column(db.Integer, db.ForeignKey("proposals.id"), nullable=False)
    item_name = db.Column(db.String(255), nullable=False)
    quantity = db.Column(db.Integer, nullable=False, default=1)
    unit_cost = db.Column(db.Float, nullable=False, default=0.0)
    status = db.Column(db.String(32), nullable=False, default="priced")


class CostingVersion(db.Model, TimestampMixin):
    __tablename__ = "costing_versions"
    id = db.Column(db.Integer, primary_key=True)
    proposal_id = db.Column(db.Integer, db.ForeignKey("proposals.id"), nullable=False)
    version_label = db.Column(db.String(32), nullable=False)
    summary = db.Column(db.Text, nullable=False, default="{}")


class TemplateAsset(db.Model, TimestampMixin):
    __tablename__ = "template_assets"
    id = db.Column(db.Integer, primary_key=True)
    asset_type = db.Column(db.String(64), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    is_duplicate_candidate = db.Column(db.Boolean, nullable=False, default=False)
    is_stale = db.Column(db.Boolean, nullable=False, default=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)


class ExportPackage(db.Model, TimestampMixin):
    __tablename__ = "export_packages"
    id = db.Column(db.Integer, primary_key=True)
    proposal_id = db.Column(db.Integer, db.ForeignKey("proposals.id"), nullable=False)
    status = db.Column(db.String(32), nullable=False, default="pending")


class StudioSlide(db.Model, TimestampMixin):
    __tablename__ = "studio_slides"
    id = db.Column(db.Integer, primary_key=True)
    proposal_id = db.Column(db.Integer, db.ForeignKey("proposals.id"), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    content = db.Column(db.Text, nullable=False, default="")
    position = db.Column(db.Integer, nullable=False, default=0)
    status = db.Column(db.String(32), nullable=False, default="ai_drafted")


class ExportDraft(db.Model, TimestampMixin):
    __tablename__ = "export_drafts"
    id = db.Column(db.Integer, primary_key=True)
    proposal_id = db.Column(db.Integer, db.ForeignKey("proposals.id"), nullable=False)
    parent_version = db.Column(db.String(32), nullable=False, default="v1")
    artifact_type = db.Column(db.String(64), nullable=False, default="PDF+Deck")
    state = db.Column(db.String(32), nullable=False, default="staged")


class PricingCatalogItem(db.Model, TimestampMixin):
    __tablename__ = "pricing_catalog_items"
    id = db.Column(db.Integer, primary_key=True)
    item_name = db.Column(db.String(255), nullable=False)
    unit = db.Column(db.String(64), nullable=False, default="unit")
    current_price = db.Column(db.Float, nullable=False, default=0.0)
    is_stale = db.Column(db.Boolean, nullable=False, default=False)
    has_variance_warning = db.Column(db.Boolean, nullable=False, default=False)


class Approval(db.Model, TimestampMixin):
    __tablename__ = "approvals"
    id = db.Column(db.Integer, primary_key=True)
    proposal_id = db.Column(db.Integer, db.ForeignKey("proposals.id"), nullable=False)
    approver = db.Column(db.String(255), nullable=False)
    decision = db.Column(db.String(32), nullable=False, default="pending")


class AuditEvent(db.Model, TimestampMixin):
    __tablename__ = "audit_events"
    id = db.Column(db.Integer, primary_key=True)
    proposal_id = db.Column(db.Integer, nullable=True)
    event_type = db.Column(db.String(64), nullable=False)
    details = db.Column(db.Text, nullable=False, default="{}")
