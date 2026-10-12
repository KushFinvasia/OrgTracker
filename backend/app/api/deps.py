from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token
from app.models import Account, Employee
from app.services.scope import Scope

bearer = HTTPBearer(auto_error=False)


@dataclass
class Ctx:
    db: Session
    account: Account
    scope: Scope

    @property
    def me(self) -> int:
        return self.account.employee_id

    @property
    def employee(self) -> Employee:
        return self.account.employee


def get_ctx(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> Ctx:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"message": "Sign in to continue.", "code": "unauthenticated"})
    account_id = decode_token(creds.credentials)
    account = db.get(Account, account_id) if account_id else None
    if account is None or not account.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"message": "Your session has expired. Sign in again.", "code": "session_expired"})
    return Ctx(db=db, account=account, scope=Scope(db, account))
