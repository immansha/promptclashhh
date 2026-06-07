from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from .database import get_db
from .models import User


def get_current_user(
    x_user_id: str = Header(..., alias="X-User-Id"),
    db: Session = Depends(get_db),
) -> User:
    """
    Resolve the caller's identity from the X-User-Id request header.
    All mutating endpoints require this header.
    """
    user = db.get(User, x_user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown user. POST /identity first.",
        )
    return user
