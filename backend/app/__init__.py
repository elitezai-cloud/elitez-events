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


def _seed_demo_user(app: Flask) -> None:
    from .models import User
    with app.app_context():
        if not User.query.filter_by(email="demo@elitez.local").first():
            pw = bcrypt.generate_password_hash("demo2026").decode("utf-8")
            db.session.add(User(email="demo@elitez.local", pw_hash=pw))
            db.session.commit()


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
