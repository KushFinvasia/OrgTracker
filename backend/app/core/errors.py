from fastapi import HTTPException, status


class RuleViolation(HTTPException):
    """A business rule blocked the action. `field` lets the UI focus the invalid input."""

    def __init__(self, message: str, field: str | None = None, code: str = "rule_violation"):
        super().__init__(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"message": message, "field": field, "code": code})


class Forbidden(HTTPException):
    def __init__(self, message: str = "This record is outside your permitted scope."):
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail={"message": message, "code": "forbidden"})


class NotFound(HTTPException):
    def __init__(self, what: str = "Record"):
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail={"message": f"{what} not found.", "code": "not_found"})


class Conflict(HTTPException):
    def __init__(self, message: str, current: dict | None = None):
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail={"message": message, "code": "version_conflict", "current": current})
