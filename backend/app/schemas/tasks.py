from datetime import date

from pydantic import BaseModel, Field


class AssignmentIn(BaseModel):
    employee_id: int
    role: str  # Owner | Contributor
    share: float = Field(description="Percent, e.g. 60")


class TaskIn(BaseModel):
    project_id: int
    milestone_id: int | None = None
    title: str = Field(min_length=3, max_length=250)
    description: str = Field(min_length=1)
    complexity: int = Field(ge=1, le=5)
    start_date: date | None = None
    due_date: date | None = None
    reviewer_id: int | None = None
    assignments: list[AssignmentIn]
    checklist: list[str] = []
    required_evidence: str | None = None
    depends_on: list[int] = []
    category: str | None = None


class TaskPatch(BaseModel):
    version: int
    title: str | None = None
    description: str | None = None
    status: str | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    next_action: str | None = None
    milestone_id: int | None = None
    complexity: int | None = Field(default=None, ge=1, le=5)
    checklist: list[str] | None = None
    reviewer_id: int | None = None


class AssignmentsPut(BaseModel):
    version: int
    reviewer_id: int
    assignments: list[AssignmentIn]
    reason: str = Field(min_length=3)


class SubmitIn(BaseModel):
    submission_date: date
    note: str | None = None
    evidence_ids: list[int] = []
    checklist_confirmed: bool


class ReviewIn(BaseModel):
    decision: str  # accept | rework
    reason_category: str | None = None
    failed_criteria: list[str] = []
    feedback: str | None = None
    requirement_changed: bool = False


class BlockerIn(BaseModel):
    category: str
    description: str
    blocked_since: date
    evidence: str
    validator_id: int
    blocking_task_id: int | None = None


class DeadlineChangeIn(BaseModel):
    requested_date: date
    reason_category: str
    comment: str = Field(min_length=3)
    evidence: str | None = None
    validator_id: int


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
