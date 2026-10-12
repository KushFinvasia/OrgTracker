from datetime import date

from pydantic import BaseModel, Field


class ProjectIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    priority: str | None = None  # validated server-side: mandatory, no default
    owner_id: int | None = None
    department_id: int | None = None
    objective: str | None = None
    start_date: date | None = None
    target_date: date | None = None
    template_id: int | None = None
    reviewer_id: int | None = None


class ProjectPatch(BaseModel):
    version: int
    title: str | None = None
    priority: str | None = None
    objective: str | None = None
    owner_id: int | None = None
    reviewer_id: int | None = None
    start_date: date | None = None
    target_date: date | None = None
    status: str | None = None
    archived: bool | None = None


class MilestoneIn(BaseModel):
    title: str
    owner_id: int
    target_date: date
    acceptance_criterion: str
    evidence: str | None = None
    state: str = "Planned"
    dependency: str | None = None
    task_ids: list[int] = []


class RiskIn(BaseModel):
    risk: str
    stage: str
    criticality: str
    owner_id: int
    next_review: date
    state: str = "Open"
    dependencies: str | None = None
    assumptions: str | None = None
    mitigation: str
    linked_task_id: int | None = None


class IncidentIn(BaseModel):
    title: str
    product_system: str
    incident_date: date
    received_date: date
    reporter_id: int
    severity_proposed: str
    clients_impacted: int | None = None
    orders_impacted: int | None = None
    responsible_department_id: int
    stakeholder_id: int


class RcaPatch(BaseModel):
    root_cause: str | None = None
    root_cause_category: str | None = None
    gap: str | None = None
    correction_action: str | None = None
    correction_date: date | None = None
    expected_closure: date | None = None
    state: str | None = None


class AttributionIn(BaseModel):
    severity_validated: str
    attribution: str  # validated | not_established
    attributed_employee_id: int | None = None
    reason: str
    evidence: str


class PreventiveTaskIn(BaseModel):
    title: str
    owner_id: int
    due_date: date
    reviewer_id: int
    complexity: int = Field(default=2, ge=1, le=5)


class IncidentCloseIn(BaseModel):
    actual_closure: date
    verification_note: str
    repeat_of_id: int | None = None


class ReopenIn(BaseModel):
    reason: str


class ClosureStageIn(BaseModel):
    stage: str
    done: bool
    note: str | None = None


class RequestIn(BaseModel):
    title: str
    template_id: int | None = None
    requesting_department_id: int
    receiving_department_id: int
    audience: str | None = None
    objective: str
    required_date: date
    priority: str | None = None
    brief: str
    validator_id: int
