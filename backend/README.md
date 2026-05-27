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

## Deploy / credential operations

This repository includes local backend scaffolding plus a UI preview workflow, but it does not include production backend deployment automation.

- Production backend URL is external to this repo and should be set in `APP_BASE_URL` in the process environment (for example, `https://api.<your-domain>.com`).
- `SESSION_COOKIE_SECURE` should be set to `1` in any HTTPS-hosted production deployment.
- CSRF protection is enabled for authenticated state-changing API requests. Clients must send the `csrf_token` returned by `/api/auth/login` or `/api/auth/me` in the `X-CSRFToken` header.
- `LOGIN_RATE_LIMIT` controls the login throttle for `POST /api/auth/login` and defaults to `10 per minute;50 per hour`.
- `RATELIMIT_STORAGE_URI` controls Flask-Limiter storage. Use a shared backend such as Redis for multi-process production deployments.
- No Personal Access Token (PAT) rotation logic is implemented in this codebase; deploy token rotation must be handled by the infrastructure owner on the hosting platform.
