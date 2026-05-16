import os

from flask import Flask, send_from_directory
from flask_migrate import Migrate

from .models import db
from .api.routes import api_bp

migrate = Migrate()

UI_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "ui-shell")
)


def _database_uri() -> str:
    uri = os.environ.get("DATABASE_URL", "sqlite:///elitez_events.db")
    # Railway/Heroku-style Postgres URLs use the legacy scheme.
    if uri.startswith("postgres://"):
        uri = uri.replace("postgres://", "postgresql://", 1)
    return uri


def create_app() -> Flask:
    app = Flask(__name__, static_folder=UI_DIR, static_url_path="")
    app.config["SQLALCHEMY_DATABASE_URI"] = _database_uri()
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SECRET_KEY"] = os.environ.get("APP_SECRET_KEY", "change-me")

    db.init_app(app)
    migrate.init_app(app, db)
    app.register_blueprint(api_bp, url_prefix="/api")

    with app.app_context():
        db.create_all()

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.get("/")
    def index():
        return send_from_directory(UI_DIR, "index.html")

    return app
