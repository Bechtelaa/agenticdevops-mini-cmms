"""Work-order API — FS §5's state machine, planning, and audit trail.

Every status change goes through :func:`_apply_transition` — the single
choke point that updates ``status`` and writes the ``work_order_transitions``
audit row in the same transaction. FS-Q8 UNS publishing (a later task) hooks
there; do not add a second write path.

Executor rule (PM decision): the schema has no executor column and needs
none — starting a WO sets ``assigned_to`` to the starter, so while a WO is
``in_progress`` the executor *is* ``assigned_to``. Abandon back to ``open``
clears the assignment (work returns to the unclaimed queue); back to
``planned`` keeps it.

Explicit independence (FS §4): completing or cancelling a WO never ends its
downtime event — nothing here touches ``downtime_events`` rows.
"""

from datetime import UTC, datetime
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app import models
from app.assets import DowntimeEventOut
from app.auth import DbSession, require_planner, require_user
from app.downtime import _event_out

router = APIRouter(prefix="/work-orders", tags=["work-orders"])

_TERMINAL = frozenset(
    {models.WorkOrderStatus.COMPLETED, models.WorkOrderStatus.CANCELLED}
)


class WorkOrderOut(BaseModel):
    id: int
    asset_id: int
    origin: models.WorkOrderOrigin
    downtime_event_id: int | None
    title: str
    description: str | None
    priority: models.WorkOrderPriority
    status: models.WorkOrderStatus
    created_by: int | None
    assigned_to: int | None
    scheduled_start: datetime | None
    expected_duration_minutes: int | None
    completion_notes: str | None
    created_at: datetime
    updated_at: datetime


class TransitionOut(BaseModel):
    from_status: models.WorkOrderStatus
    to_status: models.WorkOrderStatus
    at: datetime
    by_user: int | None
    note: str | None


class WorkOrderDetailOut(WorkOrderOut):
    downtime_event: DowntimeEventOut | None
    transitions: list[TransitionOut]


class WorkOrderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: int
    title: str
    description: str | None = None
    # FS-Q6: default medium, settable at creation by either role.
    priority: models.WorkOrderPriority = models.WorkOrderPriority.MEDIUM


class WorkOrderEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    description: str | None = None


class PlanBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assigned_to: int | None = None
    scheduled_start: datetime | None = None
    expected_duration_minutes: int | None = None
    priority: models.WorkOrderPriority | None = None

    @model_validator(mode="after")
    def _at_least_one_field(self) -> "PlanBody":
        if not self.model_fields_set:
            raise ValueError("at least one planning field is required")
        return self


class CompleteBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completion_notes: str

    @field_validator("completion_notes")
    @classmethod
    def _non_empty(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("completion_notes must be non-empty")
        return stripped


class AbandonBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str

    @field_validator("note")
    @classmethod
    def _non_empty(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("note must be non-empty")
        return stripped


class CancelBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = None


def _wo_out(wo: models.WorkOrder) -> WorkOrderOut:
    return WorkOrderOut(
        id=wo.id,
        asset_id=wo.asset_id,
        origin=wo.origin,
        downtime_event_id=wo.downtime_event_id,
        title=wo.title,
        description=wo.description,
        priority=wo.priority,
        status=wo.status,
        created_by=wo.created_by,
        assigned_to=wo.assigned_to,
        scheduled_start=wo.scheduled_start,
        expected_duration_minutes=wo.expected_duration_minutes,
        completion_notes=wo.completion_notes,
        created_at=wo.created_at,
        updated_at=wo.updated_at,
    )


def _detail_out(db: DbSession, wo: models.WorkOrder) -> WorkOrderDetailOut:
    event = (
        db.get(models.DowntimeEvent, wo.downtime_event_id)
        if wo.downtime_event_id is not None
        else None
    )
    transitions = db.scalars(
        sa.select(models.WorkOrderTransition)
        .where(models.WorkOrderTransition.work_order_id == wo.id)
        .order_by(models.WorkOrderTransition.at, models.WorkOrderTransition.id)
    ).all()
    return WorkOrderDetailOut(
        **_wo_out(wo).model_dump(),
        downtime_event=_event_out(event) if event is not None else None,
        transitions=[
            TransitionOut(
                from_status=t.from_status,
                to_status=t.to_status,
                at=t.at,
                by_user=t.by_user,
                note=t.note,
            )
            for t in transitions
        ],
    )


def _get_wo_or_404(db: DbSession, work_order_id: int) -> models.WorkOrder:
    wo = db.get(models.WorkOrder, work_order_id)
    if wo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="work order not found"
        )
    return wo


def _wrong_state(action: str, wo: models.WorkOrder) -> HTTPException:
    # 409s always name the current status.
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"cannot {action} a work order in status '{wo.status.value}'",
    )


def _forbidden(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=message)


def _apply_transition(
    db: DbSession,
    wo: models.WorkOrder,
    to_status: models.WorkOrderStatus,
    by_user: int | None,
    note: str | None = None,
) -> None:
    """The single write path for every status change.

    Updates the WO status and writes the audit row in the same transaction.
    FS-Q8 UNS publishing hooks here later (DEC-007) — never add a second path.
    """
    from_status = wo.status
    wo.status = to_status
    db.add(
        models.WorkOrderTransition(
            work_order_id=wo.id,
            from_status=from_status,
            to_status=to_status,
            at=datetime.now(UTC),
            by_user=by_user,
            note=note,
        )
    )
    db.commit()
    db.refresh(wo)


@router.get("", response_model=list[WorkOrderOut])
def list_work_orders(
    db: DbSession,
    _user: Annotated[models.User, Depends(require_user)],
    status_filter: Annotated[
        models.WorkOrderStatus | None, Query(alias="status")
    ] = None,
    asset_id: int | None = None,
    assigned_to: int | None = None,
    origin: models.WorkOrderOrigin | None = None,
    priority: models.WorkOrderPriority | None = None,
) -> list[WorkOrderOut]:
    """Filters are exact-match and ANDed. The Planner queue (FS §6) is
    ``status=open``; "my work" is ``assigned_to=<own id>`` — both canned
    filters, not endpoints."""
    query = sa.select(models.WorkOrder).order_by(
        models.WorkOrder.created_at.desc(), models.WorkOrder.id.desc()
    )
    if status_filter is not None:
        query = query.where(models.WorkOrder.status == status_filter)
    if asset_id is not None:
        query = query.where(models.WorkOrder.asset_id == asset_id)
    if assigned_to is not None:
        query = query.where(models.WorkOrder.assigned_to == assigned_to)
    if origin is not None:
        query = query.where(models.WorkOrder.origin == origin)
    if priority is not None:
        query = query.where(models.WorkOrder.priority == priority)
    return [_wo_out(wo) for wo in db.scalars(query).all()]


@router.get("/{work_order_id}", response_model=WorkOrderDetailOut)
def work_order_detail(
    work_order_id: int,
    db: DbSession,
    _user: Annotated[models.User, Depends(require_user)],
) -> WorkOrderDetailOut:
    return _detail_out(db, _get_wo_or_404(db, work_order_id))


@router.post("", response_model=WorkOrderOut, status_code=status.HTTP_201_CREATED)
def create_work_order(
    payload: WorkOrderCreate,
    db: DbSession,
    user: Annotated[models.User, Depends(require_user)],
) -> WorkOrderOut:
    """Direct manual creation (either role): origin ``manual``, no event,
    status ``open``. Creation is not a transition — no audit row."""
    asset = db.get(models.Asset, payload.asset_id)
    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="asset not found"
        )
    if asset.retired:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="asset is retired — no new activity on retired assets",
        )
    wo = models.WorkOrder(
        asset_id=asset.id,
        origin=models.WorkOrderOrigin.MANUAL,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        created_by=user.id,
    )
    db.add(wo)
    db.commit()
    db.refresh(wo)
    return _wo_out(wo)


@router.patch("/{work_order_id}", response_model=WorkOrderOut)
def edit_work_order(
    work_order_id: int,
    payload: WorkOrderEdit,
    db: DbSession,
    user: Annotated[models.User, Depends(require_user)],
) -> WorkOrderOut:
    """Edit title/description before work starts — creator or any Planner.

    Priority is deliberately absent: post-creation priority changes are
    Planner work and live in ``plan`` (FS §5: "adjustable by Planners").
    """
    wo = _get_wo_or_404(db, work_order_id)
    if wo.status not in (models.WorkOrderStatus.OPEN, models.WorkOrderStatus.PLANNED):
        raise _wrong_state("edit", wo)
    if user.role is not models.UserRole.PLANNER and wo.created_by != user.id:
        raise _forbidden("only the creator or a planner may edit a work order")

    fields = payload.model_fields_set
    if "title" in fields and payload.title is not None:
        wo.title = payload.title
    if "description" in fields:
        wo.description = payload.description
    db.commit()
    db.refresh(wo)
    return _wo_out(wo)


@router.post("/{work_order_id}/plan", response_model=WorkOrderDetailOut)
def plan_work_order(
    work_order_id: int,
    payload: PlanBody,
    db: DbSession,
    user: Annotated[models.User, Depends(require_planner)],
) -> WorkOrderDetailOut:
    """Open → Planned (transition row); re-planning a Planned WO updates
    fields with **no** row — rows record status changes only."""
    wo = _get_wo_or_404(db, work_order_id)
    if wo.status not in (models.WorkOrderStatus.OPEN, models.WorkOrderStatus.PLANNED):
        raise _wrong_state("plan", wo)

    fields = payload.model_fields_set
    if "assigned_to" in fields and payload.assigned_to is not None:
        assignee = db.get(models.User, payload.assigned_to)
        if assignee is None or not assignee.active:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="assigned_to must reference an existing active user",
            )
    if "assigned_to" in fields:
        wo.assigned_to = payload.assigned_to
    if "scheduled_start" in fields:
        wo.scheduled_start = payload.scheduled_start
    if "expected_duration_minutes" in fields:
        wo.expected_duration_minutes = payload.expected_duration_minutes
    if "priority" in fields and payload.priority is not None:
        wo.priority = payload.priority

    if wo.status is models.WorkOrderStatus.OPEN:
        _apply_transition(db, wo, models.WorkOrderStatus.PLANNED, by_user=user.id)
    else:  # re-plan: fields only, no transition row
        db.commit()
        db.refresh(wo)
    return _detail_out(db, wo)


@router.post("/{work_order_id}/start", response_model=WorkOrderDetailOut)
def start_work_order(
    work_order_id: int,
    db: DbSession,
    user: Annotated[models.User, Depends(require_user)],
) -> WorkOrderDetailOut:
    """Open → In Progress: anyone, self-serve (the 3am case) — claims the WO.
    Planned → In Progress: the assignee only (FS §2 — Planners included)."""
    wo = _get_wo_or_404(db, work_order_id)
    if wo.status is models.WorkOrderStatus.OPEN:
        wo.assigned_to = user.id  # self-serve start claims the WO
    elif wo.status is models.WorkOrderStatus.PLANNED:
        if wo.assigned_to != user.id:
            raise _forbidden("only the assignee may start a planned work order")
    else:
        raise _wrong_state("start", wo)
    _apply_transition(db, wo, models.WorkOrderStatus.IN_PROGRESS, by_user=user.id)
    return _detail_out(db, wo)


@router.post("/{work_order_id}/complete", response_model=WorkOrderDetailOut)
def complete_work_order(
    work_order_id: int,
    payload: CompleteBody,
    db: DbSession,
    user: Annotated[models.User, Depends(require_user)],
) -> WorkOrderDetailOut:
    """In Progress → Completed — the executor only, notes required.

    Never ends the linked downtime event (FS §4 independence).
    """
    wo = _get_wo_or_404(db, work_order_id)
    if wo.status is not models.WorkOrderStatus.IN_PROGRESS:
        raise _wrong_state("complete", wo)
    if wo.assigned_to != user.id:
        raise _forbidden(
            "only the executor (assigned user) may complete a work order"
        )
    wo.completion_notes = payload.completion_notes
    _apply_transition(db, wo, models.WorkOrderStatus.COMPLETED, by_user=user.id)
    return _detail_out(db, wo)


@router.post("/{work_order_id}/abandon", response_model=WorkOrderDetailOut)
def abandon_work_order(
    work_order_id: int,
    payload: AbandonBody,
    db: DbSession,
    user: Annotated[models.User, Depends(require_user)],
) -> WorkOrderDetailOut:
    """In Progress → back where it came from (FS §5 "moves back"), executor
    or any Planner (FS-Q4), note required — work returns to the queue."""
    wo = _get_wo_or_404(db, work_order_id)
    if wo.status is not models.WorkOrderStatus.IN_PROGRESS:
        raise _wrong_state("abandon", wo)
    if user.role is not models.UserRole.PLANNER and wo.assigned_to != user.id:
        raise _forbidden(
            "only the executor or a planner may abandon a work order"
        )

    # Target: the from_status of the latest transition INTO in_progress.
    entered_from = db.scalar(
        sa.select(models.WorkOrderTransition.from_status)
        .where(
            models.WorkOrderTransition.work_order_id == wo.id,
            models.WorkOrderTransition.to_status
            == models.WorkOrderStatus.IN_PROGRESS,
        )
        .order_by(
            models.WorkOrderTransition.at.desc(), models.WorkOrderTransition.id.desc()
        )
        .limit(1)
    )
    target = (
        entered_from
        if entered_from is not None
        else models.WorkOrderStatus.OPEN  # defensive: no audit row found
    )
    if target is models.WorkOrderStatus.OPEN:
        wo.assigned_to = None  # back to the unclaimed queue
    _apply_transition(db, wo, target, by_user=user.id, note=payload.note)
    return _detail_out(db, wo)


@router.post("/{work_order_id}/cancel", response_model=WorkOrderDetailOut)
def cancel_work_order(
    work_order_id: int,
    db: DbSession,
    user: Annotated[models.User, Depends(require_planner)],
    payload: CancelBody | None = None,
) -> WorkOrderDetailOut:
    """Any non-terminal → Cancelled — Planner only (FS-Q4)."""
    wo = _get_wo_or_404(db, work_order_id)
    if wo.status in _TERMINAL:
        raise _wrong_state("cancel", wo)
    note = payload.note if payload is not None else None
    _apply_transition(
        db, wo, models.WorkOrderStatus.CANCELLED, by_user=user.id, note=note
    )
    return _detail_out(db, wo)
