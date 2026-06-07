from sqlalchemy.orm import Session

from .models import User
from .schemas import IdentityRequest, IdentityResponse


def get_or_create_user(db: Session, payload: IdentityRequest) -> IdentityResponse:
    """
    Return existing user or create a new one, keyed by email.
    """
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        return IdentityResponse(
            user_id=existing.id,
            name=existing.name,
            email=existing.email,
            created=False,
        )

    user = User(name=payload.name, email=payload.email)
    db.add(user)
    db.commit()
    db.refresh(user)

    return IdentityResponse(
        user_id=user.id,
        name=user.name,
        email=user.email,
        created=True,
    )
