from . import json
from ..models import AuditEvent, db


def record_audit(event_type: str, details: dict, proposal_id: int | None = None) -> None:
    event = AuditEvent(
        proposal_id=proposal_id,
        event_type=event_type,
        details=json.dumps(details),
    )
    db.session.add(event)
    db.session.commit()
