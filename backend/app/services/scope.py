"""Server-side access scope. Every query that returns people, work or scores goes through this.

Work access and private performance access are separate:
- work: reporting tree, headed departments, project ownership/review/membership, assignments, time-bound grants
- performance (KPI, check-ins, training score): reporting tree (Manager) or headed departments (HOD) only.
  Team Leads never receive private performance data. Project membership never extends performance scope.
"""

from __future__ import annotations

from datetime import date
from functools import cached_property

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.errors import Forbidden
from app.models import AccessGrant, Account, Assignment, DepartmentHead, Employee, Project, ProjectMember, Task


class Scope:
    def __init__(self, db: Session, account: Account):
        self.db = db
        self.account = account
        self.role = account.role
        self.me = account.employee_id

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @cached_property
    def _children(self) -> dict[int, list[int]]:
        children: dict[int, list[int]] = {}
        for emp_id, mgr_id in self.db.execute(select(Employee.id, Employee.manager_id)):
            if mgr_id:
                children.setdefault(mgr_id, []).append(emp_id)
        return children

    def descendants(self, root: int) -> set[int]:
        out, stack = set(), list(self._children.get(root, []))
        while stack:
            e = stack.pop()
            if e not in out:
                out.add(e)
                stack.extend(self._children.get(e, []))
        return out

    @cached_property
    def reporting_tree(self) -> set[int]:
        return self.descendants(self.me)

    @cached_property
    def headed_departments(self) -> set[int]:
        if self.role != "hod":
            return set()
        return set(self.db.scalars(select(DepartmentHead.department_id).where(DepartmentHead.employee_id == self.me)))

    @cached_property
    def department_people(self) -> set[int]:
        if not self.headed_departments:
            return set()
        return set(self.db.scalars(select(Employee.id).where(Employee.department_id.in_(self.headed_departments))))

    @cached_property
    def work_people(self) -> set[int] | None:
        """People whose work this account can see and (subject to role) update. None = everyone."""
        if self.is_admin:
            return None
        return self.reporting_tree | self.department_people | {self.me}

    @cached_property
    def perf_people(self) -> set[int] | None:
        """People whose private KPI / check-in / training score this account can see. None = everyone."""
        if self.is_admin:
            return None
        if self.role == "team_lead":
            return set()
        return (self.reporting_tree | self.department_people) - {self.me}

    @cached_property
    def active_grants(self) -> dict[int, str]:
        today = date.today()
        rows = self.db.execute(
            select(AccessGrant.project_id, AccessGrant.permission).where(
                AccessGrant.account_id == self.account.id,
                AccessGrant.revoked_at.is_(None),
                AccessGrant.starts_on <= today,
                AccessGrant.expires_on >= today,
            )
        )
        grants: dict[int, str] = {}
        for pid, perm in rows:
            if grants.get(pid) != "edit":
                grants[pid] = perm
        return grants

    @cached_property
    def visible_project_ids(self) -> set[int] | None:
        if self.is_admin:
            return None
        people = self.work_people or set()
        conds = [Project.owner_id.in_(people), Project.reviewer_id == self.me]
        if self.headed_departments:
            conds.append(Project.department_id.in_(self.headed_departments))
        ids = set(self.db.scalars(select(Project.id).where(or_(*conds))))
        ids |= set(self.db.scalars(select(Task.project_id).join(Assignment).where(Assignment.employee_id.in_(people))))
        ids |= set(self.db.scalars(select(Task.project_id).where(Task.reviewer_id == self.me)))
        ids |= set(self.db.scalars(select(ProjectMember.project_id).where(ProjectMember.employee_id.in_(people))))
        ids |= set(self.active_grants)
        return ids

    # --- checks -------------------------------------------------------------------------------

    def can_see_project(self, project_id: int) -> bool:
        ids = self.visible_project_ids
        return ids is None or project_id in ids

    def require_project(self, project_id: int) -> None:
        if not self.can_see_project(project_id):
            raise Forbidden()

    def can_manage_project(self, project: Project) -> bool:
        """Create/edit project-level records (milestones, risks, closure). Team Leads update work only."""
        if self.is_admin:
            return True
        if self.role == "team_lead":
            return False
        if project.owner_id == self.me or project.owner_id in (self.work_people or set()):
            return True
        if project.department_id in self.headed_departments:
            return True
        return self.active_grants.get(project.id) == "edit"

    def can_update_task(self, task: Task) -> bool:
        """Status, progress, next action, comments and evidence for the account's own team."""
        if self.is_admin:
            return True
        people = self.work_people or set()
        if any(a.employee_id in people for a in task.assignments):
            return True
        project = self.db.get(Project, task.project_id)
        return bool(project and self.can_manage_project(project))

    def can_see_perf(self, employee_id: int) -> bool:
        people = self.perf_people
        return people is None or employee_id in people

    def require_perf(self, employee_id: int) -> None:
        if not self.can_see_perf(employee_id):
            raise Forbidden("Your access does not include this person's private performance or training score.")

    def can_see_person(self, employee_id: int) -> bool:
        people = self.work_people
        return people is None or employee_id in people

    def require_role(self, *roles: str) -> None:
        if self.role not in roles:
            raise Forbidden("Your role cannot perform this action.")
