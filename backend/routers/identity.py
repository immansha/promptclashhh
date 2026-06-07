from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import IdentityRequest, IdentityResponse
from ..services import get_or_create_user

router = APIRouter(prefix="/identity", tags=["identity"])


@router.post("", response_model=IdentityResponse, status_code=200)
def identify(payload: IdentityRequest, db: Session = Depends(get_db)):
    """
    Create a user if one doesn't exist for the given email, otherwise return
    the existing user. The returned user_id should be stored in localStorage
    and sent as the X-User-Id header on all subsequent requests.
    """
    return get_or_create_user(db, payload)
