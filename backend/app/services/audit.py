from . import json
from ..models import AuditEvent, db


def record_audit(
    event_type: str,
    details: dict,
    proposal_id: int | None = None,
    actor: str | None = None,
) -> None:
    payload = dict(details)
    if actor:
        payload["_actor"] = actor
    event = AuditEvent(
        proposal_id=proposal_id,
        event_type=event_type,
        details=json.dumps(payload),
    )
    db.session.add(event)
    db.session.commit()
