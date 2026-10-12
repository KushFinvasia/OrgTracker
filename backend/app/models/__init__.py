"""Import every model so Base.metadata is complete."""

from app.models.access import AccessGrant, Account, AuditEvent, ImportBatch, Notification
from app.models.org import Department, DepartmentHead, Employee, ReportingLine
from app.models.performance import CheckIn, MetricInput, Nomination, Override, Period, RewardCycle, RuleVersion, Snapshot
from app.models.project import Incident, Milestone, Project, ProjectClosure, ProjectMember, Risk, WorkRequest
from app.models.task import (
    Assignment,
    Blocker,
    Comment,
    DeadlineChange,
    EvidenceFile,
    ReviewDecision,
    Submission,
    Task,
    TaskDependency,
    TaskEvent,
)
from app.models.training import Course, TrainingAssignment, TrainingAttempt, TrainingException
from app.models.workflow import Holiday, TemplateStage, WorkflowTemplate

__all__ = [
    "AccessGrant", "Account", "AuditEvent", "ImportBatch", "Notification",
    "Department", "DepartmentHead", "Employee", "ReportingLine",
    "CheckIn", "MetricInput", "Nomination", "Override", "Period", "RewardCycle", "RuleVersion", "Snapshot",
    "Incident", "Milestone", "Project", "ProjectClosure", "ProjectMember", "Risk", "WorkRequest",
    "Assignment", "Blocker", "Comment", "DeadlineChange", "EvidenceFile", "ReviewDecision", "Submission",
    "Task", "TaskDependency", "TaskEvent",
    "Course", "TrainingAssignment", "TrainingAttempt", "TrainingException",
    "Holiday", "TemplateStage", "WorkflowTemplate",
]
