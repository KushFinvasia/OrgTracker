from datetime import date

import pytest

from app.core.errors import RuleViolation
from app.services.common import add_business_days, task_timing
from app.services.delivery import validate_assignments

REF = date(2026, 10, 12)


def test_reviewer_waiting_time_never_makes_work_overdue():
    due = date(2026, 10, 9)
    assert task_timing("In Review", due, None, REF, submitted_on=date(2026, 10, 9)) == "Submitted on time"
    assert task_timing("In Review", due, None, REF, submitted_on=date(2026, 10, 10)) == "Submitted late"
    assert task_timing("In Review", due, None, REF) == "Awaiting review"
    assert task_timing("In Progress", due, None, REF) == "Overdue"
    assert task_timing("Completed", due, date(2026, 10, 8), REF) == "On time"
    assert task_timing("In Progress", None, None, REF) == "No deadline"


def test_assignment_rules():
    ok = [{"employee_id": 1, "role": "Owner", "share": 60}, {"employee_id": 2, "role": "Contributor", "share": 40}]
    validate_assignments(ok, reviewer_id=3)
    with pytest.raises(RuleViolation):
        validate_assignments(ok, reviewer_id=2)  # reviewer is an assignee
    with pytest.raises(RuleViolation):
        validate_assignments([{"employee_id": 1, "role": "Owner", "share": 80}, {"employee_id": 2, "role": "Contributor", "share": 40}], 3)
    with pytest.raises(RuleViolation):
        validate_assignments([{"employee_id": 1, "role": "Contributor", "share": 100}], 3)  # no Owner
    with pytest.raises(RuleViolation):
        validate_assignments([{"employee_id": 1, "role": "Owner", "share": 50}, {"employee_id": 1, "role": "Contributor", "share": 50}], 3)


def test_business_days_skip_weekends_and_holidays():
    # Mon 12 Oct 2026 + 14 business days, no holidays -> Fri 30 Oct
    assert add_business_days(date(2026, 10, 12), 14, set()) == date(2026, 10, 30)
    assert add_business_days(date(2026, 10, 1), 1, {date(2026, 10, 2)}) == date(2026, 10, 5)
