import os

from flask import Flask, jsonify, send_from_directory
from flask_bcrypt import Bcrypt
from flask_migrate import Migrate

from .models import db
from .api.routes import api_bp

migrate = Migrate()
bcrypt = Bcrypt()

UI_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "ui-shell")
)


def _database_uri() -> str:
    uri = os.environ.get("DATABASE_URL", "sqlite:///elitez_events.db")
    if uri.startswith("postgres://"):
        uri = uri.replace("postgres://", "postgresql://", 1)
    return uri


def _run_additive_migrations(app: Flask) -> None:
    """Add columns introduced in 3746a99 to pre-existing prod tables idempotently."""
    is_pg = app.config["SQLALCHEMY_DATABASE_URI"].startswith("postgresql")

    def _add(table: str, col: str) -> None:
        stmt = (
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col}"
            if is_pg
            else f"ALTER TABLE {table} ADD COLUMN {col}"
        )
        try:
            db.session.execute(db.text(stmt))
            db.session.commit()
        except Exception:
            db.session.rollback()

    with app.app_context():
        _add("proposals", "current_stage VARCHAR(32) NOT NULL DEFAULT 'tender_intake'")
        _add("proposals", "requirements_approved_by VARCHAR(255)")
        _add("proposals", "requirements_approved_at TIMESTAMP")
        _add("proposals", "concept_approved_by VARCHAR(255)")
        _add("proposals", "concept_approved_at TIMESTAMP")
        _add("tender_documents", "extracted_text TEXT")
        _add("tender_documents", "extracted_summary TEXT")
        _add("requirements", "confidence FLOAT NOT NULL DEFAULT 0.0")
        _add("requirements", "field_label VARCHAR(255)")
        _add("requirements", "section_id VARCHAR(64)")
        _add("requirements", "missing_field_severity VARCHAR(16) NOT NULL DEFAULT 'optional'")
        _add("requirements", "source_refs TEXT NOT NULL DEFAULT '[]'")
        _add("requirements", "is_edited BOOLEAN NOT NULL DEFAULT false")
        _add("requirements", "is_deleted BOOLEAN NOT NULL DEFAULT false")
        _add("concepts", "fit_score FLOAT NOT NULL DEFAULT 0.5")
        _add("concepts", "tags TEXT NOT NULL DEFAULT '[]'")
        _add("concepts", "rationale TEXT")
        _add("concepts", "kb_references TEXT NOT NULL DEFAULT '[]'")
        _add("concepts", "status VARCHAR(16) NOT NULL DEFAULT 'available'")
        _add("concepts", "rejected_reason TEXT")


def _seed_demo_user(app: Flask) -> None:
    from .models import User
    try:
        with app.app_context():
            existing = User.query.filter_by(email="demo@elitez.local").first()
            import bcrypt as _bcrypt
            pw = _bcrypt.hashpw(b"demo2026", _bcrypt.gensalt()).decode("utf-8")
            if not existing:
                db.session.add(User(email="demo@elitez.local", pw_hash=pw))
            else:
                existing.pw_hash = pw
            db.session.commit()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error("Demo seed failed: %s", exc)


def create_app() -> Flask:
    app = Flask(__name__, static_folder=UI_DIR, static_url_path="")
    app.config["SQLALCHEMY_DATABASE_URI"] = _database_uri()
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SECRET_KEY"] = os.environ.get("APP_SECRET_KEY", "change-me")
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

    db.init_app(app)
    migrate.init_app(app, db)
    bcrypt.init_app(app)
    app.register_blueprint(api_bp, url_prefix="/api")

    with app.app_context():
        db.create_all()
    _run_additive_migrations(app)
    _seed_demo_user(app)

    @app.get("/health")
    def health():
        try:
            db.session.execute(db.text("SELECT 1"))
            return jsonify({"ok": True, "db": "reachable"})
        except Exception as exc:
            return jsonify({"ok": False, "db": "unreachable", "error": type(exc).__name__}), 503

    @app.get("/")
    def index():
        return send_from_directory(UI_DIR, "index.html")

    return app
