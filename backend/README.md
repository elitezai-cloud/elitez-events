# ElitezEvents Backend Scaffold

Production backend scaffold for ELIA-124.

## Included

- Flask + SQLAlchemy + Flask-Migrate setup
- Core tables for proposals, documents, requirements, concepts, costing, templates/assets, exports, approvals, audit events
- API routes for upload, parse status, requirement edit, concept generate/retry, costing, proposal generation, export package, admin assets, audit trail, approvals
- `.env.example` with non-secret environment variable names
- Baseline pytest coverage for core workflow path

## Run

```bash
pip install -r requirements.txt
python run.py
```
