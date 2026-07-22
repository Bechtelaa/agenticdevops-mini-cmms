"""Work-order API integration tests — tmp-path DBs only, existing fixture
pattern. Three seeded accounts: a planner and two users (executor-gate
proofs need a second non-assignee user).
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import bcrypt
import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from app import config, db, models
from app.main import app
from tests.test_migrations import upgrade_to_head

PW = "shared-test-pw"
_HASH = bcrypt.hashpw(PW.encode(), bcrypt.gensalt(rounds=4)).decode()

_USERS_TOML = f'''
[[users]]
username = "planner1"
password_hash = "{_HASH}"
role = "planner"

[[users]]
username = "tech1"
password_hash = "{_HASH}"
role = "user"

[[users]]
username = "tech2"
password_hash = "{_HASH}"
role = "user"
'''


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    url = f"sqlite:///{tmp_path / 'wo.db'}"
    upgrade_to_head(url)
    users_file = tmp_path / "users.toml"
    users_file.write_text(_USERS_TOML)
    monkeypatch.setenv(config.ENV_DATABASE_URL, url)
    monkeypatch.setenv(config.ENV_USERS_FILE, str(users_file))
    db.get_engine.cache_clear()
    db.get_session_factory.cache_clear()
    with TestClient(app) as test_client:
        yield test_client
    db.get_engine.cache_clear()
    db.get_session_factory.cache_clear()


def _auth(client: TestClient, username: str) -> dict[str, str]:
    response = client.post(
        "/auth/login", json={"username": username, "password": PW}
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


@pytest.fixture()
def planner(client: TestClient) -> dict[str, str]:
    return _auth(client, "planner1")


@pytest.fixture()
def tech1(client: TestClient) -> dict[str, str]:
    return _auth(client, "tech1")


@pytest.fixture()
def tech2(client: TestClient) -> dict[str, str]:
    return _auth(client, "tech2")


def _user_id(username: str) -> int:
    with db.get_session_factory()() as session:
        user = session.scalar(
            sa.select(models.User).where(models.User.username == username)
        )
        assert user is not None
        return user.id


def _asset(client: TestClient, auth: dict[str, str], path: str = "plant/l/a-1") -> int:
    response = client.post(
        "/assets", json={"path": path, "display_name": "A"}, headers=auth
    )
    assert response.status_code == 201
    result = response.json()["id"]
    assert isinstance(result, int)
    return result


def _create_wo(
    client: TestClient,
    auth: dict[str, str],
    asset_id: int,
    **extra: Any,
) -> int:
    response = client.post(
        "/work-orders",
        json={"asset_id": asset_id, "title": "Fix it", **extra},
        headers=auth,
    )
    assert response.status_code == 201, response.text
    result = response.json()["id"]
    assert isinstance(result, int)
    return result


def _transitions(
    client: TestClient, auth: dict[str, str], wo_id: int
) -> list[dict[str, Any]]:
    detail = client.get(f"/work-orders/{wo_id}", headers=auth)
    assert detail.status_code == 200
    result = detail.json()["transitions"]
    assert isinstance(result, list)
    return result


def test_all_endpoints_401_without_token(client: TestClient) -> None:
    assert client.get("/work-orders").status_code == 401
    assert client.get("/work-orders/1").status_code == 401
    assert client.post("/work-orders", json={}).status_code == 401
    assert client.patch("/work-orders/1", json={}).status_code == 401
    for action in ("plan", "start", "complete", "abandon", "cancel"):
        assert client.post(f"/work-orders/1/{action}", json={}).status_code == 401


def test_role_gates_hold_server_side(
    client: TestClient,
    planner: dict[str, str],
    tech1: dict[str, str],
    tech2: dict[str, str],
) -> None:
    asset_id = _asset(client, tech1)
    wo_id = _create_wo(client, tech1, asset_id)

    # user → plan / cancel: 403.
    assert (
        client.post(
            f"/work-orders/{wo_id}/plan", json={"priority": "high"}, headers=tech1
        ).status_code
        == 403
    )
    assert client.post(f"/work-orders/{wo_id}/cancel", headers=tech1).status_code == 403

    # Planner plans it onto tech1; a planner who is not the assignee cannot start.
    planned = client.post(
        f"/work-orders/{wo_id}/plan",
        json={"assigned_to": _user_id("tech1")},
        headers=planner,
    )
    assert planned.status_code == 200
    for other in (planner, tech2):
        denied_start = client.post(f"/work-orders/{wo_id}/start", headers=other)
        assert denied_start.status_code == 403

    # Assignee starts; a planner cannot complete another's in-progress WO.
    assert client.post(f"/work-orders/{wo_id}/start", headers=tech1).status_code == 200
    denied = client.post(
        f"/work-orders/{wo_id}/complete",
        json={"completion_notes": "done"},
        headers=planner,
    )
    assert denied.status_code == 403

    # Non-creator user gets 403 on PATCH (creator or planner only).
    wo2 = _create_wo(client, tech1, asset_id)
    assert (
        client.patch(
            f"/work-orders/{wo2}", json={"title": "hijack"}, headers=tech2
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/work-orders/{wo2}", json={"title": "planner ok"}, headers=planner
        ).status_code
        == 200
    )


def test_direct_creation_shape_and_priority(
    client: TestClient, tech1: dict[str, str]
) -> None:
    asset_id = _asset(client, tech1)
    default_id = _create_wo(client, tech1, asset_id)
    default_wo = client.get(f"/work-orders/{default_id}", headers=tech1).json()
    assert default_wo["origin"] == "manual"
    assert default_wo["downtime_event_id"] is None
    assert default_wo["downtime_event"] is None
    assert default_wo["status"] == "open"
    assert default_wo["created_by"] == _user_id("tech1")
    assert default_wo["priority"] == "medium"
    assert default_wo["transitions"] == []  # creation is not a transition

    # Priority settable at creation by a plain user (FS-Q6).
    high_id = _create_wo(client, tech1, asset_id, priority="high")
    assert (
        client.get(f"/work-orders/{high_id}", headers=tech1).json()["priority"]
        == "high"
    )

    # Unknown asset 404; retired asset 409.
    assert (
        client.post(
            "/work-orders", json={"asset_id": 9999, "title": "x"}, headers=tech1
        ).status_code
        == 404
    )
    retired = _asset(client, tech1, path="plant/l/retired")
    client.post(f"/assets/{retired}/retire", headers=tech1)
    assert (
        client.post(
            "/work-orders", json={"asset_id": retired, "title": "x"}, headers=tech1
        ).status_code
        == 409
    )


def test_list_filters_narrow_and_combine(
    client: TestClient, planner: dict[str, str], tech1: dict[str, str]
) -> None:
    a1 = _asset(client, tech1, path="plant/f/a1")
    a2 = _asset(client, tech1, path="plant/f/a2")
    wo_a = _create_wo(client, tech1, a1, priority="high")
    wo_b = _create_wo(client, tech1, a2)
    wo_c = _create_wo(client, planner, a2, priority="low")
    client.post(
        f"/work-orders/{wo_c}/plan",
        json={"assigned_to": _user_id("tech1")},
        headers=planner,
    )

    def ids(**params: Any) -> list[int]:
        response = client.get("/work-orders", params=params, headers=tech1)
        assert response.status_code == 200
        return [w["id"] for w in response.json()]

    assert set(ids()) == {wo_a, wo_b, wo_c}
    assert set(ids(status="open")) == {wo_a, wo_b}  # the Planner queue
    assert ids(asset_id=a1) == [wo_a]
    assert ids(assigned_to=_user_id("tech1")) == [wo_c]
    assert set(ids(origin="manual")) == {wo_a, wo_b, wo_c}
    assert ids(priority="high") == [wo_a]
    assert ids(asset_id=a2, status="open") == [wo_b]  # combined, ANDed


def test_full_lifecycle_audited_and_replan_adds_no_row(
    client: TestClient, planner: dict[str, str], tech1: dict[str, str]
) -> None:
    asset_id = _asset(client, tech1)
    wo_id = _create_wo(client, tech1, asset_id)
    tech1_id = _user_id("tech1")
    planner_id = _user_id("planner1")

    planned = client.post(
        f"/work-orders/{wo_id}/plan",
        json={
            "assigned_to": tech1_id,
            "scheduled_start": "2026-07-23T08:00:00Z",
            "expected_duration_minutes": 90,
        },
        headers=planner,
    )
    assert planned.status_code == 200
    assert planned.json()["status"] == "planned"

    # Re-plan: fields update, status unchanged, no new transition row.
    replanned = client.post(
        f"/work-orders/{wo_id}/plan", json={"priority": "high"}, headers=planner
    )
    assert replanned.status_code == 200
    assert replanned.json()["priority"] == "high"
    assert len(_transitions(client, tech1, wo_id)) == 1

    assert client.post(f"/work-orders/{wo_id}/start", headers=tech1).status_code == 200
    completed = client.post(
        f"/work-orders/{wo_id}/complete",
        json={"completion_notes": "replaced the seal"},
        headers=tech1,
    )
    assert completed.status_code == 200
    assert completed.json()["completion_notes"] == "replaced the seal"

    rows = _transitions(client, tech1, wo_id)
    assert [(r["from_status"], r["to_status"], r["by_user"]) for r in rows] == [
        ("open", "planned", planner_id),
        ("planned", "in_progress", tech1_id),
        ("in_progress", "completed", tech1_id),
    ]
    assert all(r["at"] is not None for r in rows)
    assert [r["at"] for r in rows] == sorted(r["at"] for r in rows)  # chronological


def test_self_serve_start_and_executor_gate(
    client: TestClient, tech1: dict[str, str], tech2: dict[str, str]
) -> None:
    asset_id = _asset(client, tech1)
    wo_id = _create_wo(client, tech2, asset_id)

    started = client.post(f"/work-orders/{wo_id}/start", headers=tech1)
    assert started.status_code == 200
    assert started.json()["assigned_to"] == _user_id("tech1")  # claimed

    # Only the claimer can complete.
    assert (
        client.post(
            f"/work-orders/{wo_id}/complete",
            json={"completion_notes": "nope"},
            headers=tech2,
        ).status_code
        == 403
    )

    # Empty/missing notes → 422, nothing changes.
    for bad in ({"completion_notes": "   "}, {}):
        assert (
            client.post(
                f"/work-orders/{wo_id}/complete", json=bad, headers=tech1
            ).status_code
            == 422
        )
    assert (
        client.get(f"/work-orders/{wo_id}", headers=tech1).json()["status"]
        == "in_progress"
    )

    assert (
        client.post(
            f"/work-orders/{wo_id}/complete",
            json={"completion_notes": "ok"},
            headers=tech1,
        ).status_code
        == 200
    )


def test_abandon_returns_to_origin_state(
    client: TestClient, planner: dict[str, str], tech1: dict[str, str]
) -> None:
    asset_id = _asset(client, tech1)
    tech1_id = _user_id("tech1")

    # Planned-then-started → abandon → back to planned, assignment kept.
    planned_wo = _create_wo(client, tech1, asset_id)
    client.post(
        f"/work-orders/{planned_wo}/plan",
        json={"assigned_to": tech1_id},
        headers=planner,
    )
    client.post(f"/work-orders/{planned_wo}/start", headers=tech1)
    abandoned = client.post(
        f"/work-orders/{planned_wo}/abandon",
        json={"note": "parts missing"},
        headers=tech1,
    )
    assert abandoned.status_code == 200
    assert abandoned.json()["status"] == "planned"
    assert abandoned.json()["assigned_to"] == tech1_id
    assert _transitions(client, tech1, planned_wo)[-1]["note"] == "parts missing"

    # Self-serve-started → abandon (by a planner, FS-Q4) → open, cleared.
    open_wo = _create_wo(client, tech1, asset_id)
    client.post(f"/work-orders/{open_wo}/start", headers=tech1)
    returned = client.post(
        f"/work-orders/{open_wo}/abandon",
        json={"note": "wrong asset"},
        headers=planner,
    )
    assert returned.status_code == 200
    assert returned.json()["status"] == "open"
    assert returned.json()["assigned_to"] is None
    assert _transitions(client, tech1, open_wo)[-1]["note"] == "wrong asset"

    # Note required.
    client.post(f"/work-orders/{open_wo}/start", headers=tech1)
    assert (
        client.post(
            f"/work-orders/{open_wo}/abandon", json={"note": " "}, headers=tech1
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/work-orders/{open_wo}/abandon", json={}, headers=tech1
        ).status_code
        == 422
    )

    # Both abandoned WOs are startable again.
    assert (
        client.post(f"/work-orders/{planned_wo}/start", headers=tech1).status_code
        == 200
    )


def test_cancel_gates_and_states(
    client: TestClient, planner: dict[str, str], tech1: dict[str, str]
) -> None:
    asset_id = _asset(client, tech1)
    tech1_id = _user_id("tech1")

    for setup in ("open", "planned", "in_progress"):
        wo_id = _create_wo(client, tech1, asset_id)
        if setup in ("planned", "in_progress"):
            client.post(
                f"/work-orders/{wo_id}/plan",
                json={"assigned_to": tech1_id},
                headers=planner,
            )
        if setup == "in_progress":
            client.post(f"/work-orders/{wo_id}/start", headers=tech1)
        cancelled = client.post(
            f"/work-orders/{wo_id}/cancel", json={"note": "obsolete"}, headers=planner
        )
        assert cancelled.status_code == 200, setup
        assert cancelled.json()["status"] == "cancelled"
        # Terminal → cancel again 409; user → 403.
        assert (
            client.post(f"/work-orders/{wo_id}/cancel", headers=planner).status_code
            == 409
        )

    done = _create_wo(client, tech1, asset_id)
    client.post(f"/work-orders/{done}/start", headers=tech1)
    client.post(
        f"/work-orders/{done}/complete", json={"completion_notes": "x"}, headers=tech1
    )
    cancel_completed = client.post(f"/work-orders/{done}/cancel", headers=planner)
    assert cancel_completed.status_code == 409


def test_illegal_moves_409_name_status_and_change_nothing(
    client: TestClient, planner: dict[str, str], tech1: dict[str, str]
) -> None:
    asset_id = _asset(client, tech1)

    # A completed WO: start → 409 naming "completed".
    done = _create_wo(client, tech1, asset_id)
    client.post(f"/work-orders/{done}/start", headers=tech1)
    client.post(
        f"/work-orders/{done}/complete", json={"completion_notes": "x"}, headers=tech1
    )
    rows_before = len(_transitions(client, tech1, done))
    response = client.post(f"/work-orders/{done}/start", headers=tech1)
    assert response.status_code == 409
    assert "completed" in response.json()["detail"]

    # Complete an open WO / abandon a planned WO / plan an in-progress WO.
    open_wo = _create_wo(client, tech1, asset_id)
    complete_open = client.post(
        f"/work-orders/{open_wo}/complete",
        json={"completion_notes": "x"},
        headers=tech1,
    )
    assert complete_open.status_code == 409
    assert "open" in complete_open.json()["detail"]

    planned_wo = _create_wo(client, tech1, asset_id)
    client.post(
        f"/work-orders/{planned_wo}/plan",
        json={"assigned_to": _user_id("tech1")},
        headers=planner,
    )
    abandon_planned = client.post(
        f"/work-orders/{planned_wo}/abandon", json={"note": "n"}, headers=tech1
    )
    assert abandon_planned.status_code == 409
    assert "planned" in abandon_planned.json()["detail"]

    started = _create_wo(client, tech1, asset_id)
    client.post(f"/work-orders/{started}/start", headers=tech1)
    plan_started = client.post(
        f"/work-orders/{started}/plan", json={"priority": "low"}, headers=planner
    )
    assert plan_started.status_code == 409
    assert "in_progress" in plan_started.json()["detail"]

    # No status change, no audit rows from any rejection.
    assert len(_transitions(client, tech1, done)) == rows_before
    assert (
        client.get(f"/work-orders/{open_wo}", headers=tech1).json()["status"] == "open"
    )
    assert _transitions(client, tech1, open_wo) == []


def test_plan_validation(
    client: TestClient, planner: dict[str, str], tech1: dict[str, str]
) -> None:
    asset_id = _asset(client, tech1)
    wo_id = _create_wo(client, tech1, asset_id)

    # Empty body → 422 (at least one field required).
    assert (
        client.post(f"/work-orders/{wo_id}/plan", json={}, headers=planner).status_code
        == 422
    )
    # Unknown / inactive assignee → 422.
    assert (
        client.post(
            f"/work-orders/{wo_id}/plan", json={"assigned_to": 9999}, headers=planner
        ).status_code
        == 422
    )
    assert (
        client.get(f"/work-orders/{wo_id}", headers=tech1).json()["status"] == "open"
    )


def test_patch_blocked_once_started(
    client: TestClient, tech1: dict[str, str]
) -> None:
    asset_id = _asset(client, tech1)
    wo_id = _create_wo(client, tech1, asset_id)
    client.post(f"/work-orders/{wo_id}/start", headers=tech1)
    response = client.patch(
        f"/work-orders/{wo_id}", json={"title": "too late"}, headers=tech1
    )
    assert response.status_code == 409
    assert "in_progress" in response.json()["detail"]


def test_completing_wo_leaves_downtime_event_ongoing(
    client: TestClient, tech1: dict[str, str]
) -> None:
    """FS §4 independence: the WO records what people did; the event log
    records what the asset did."""
    asset_id = _asset(client, tech1)
    reported = client.post(f"/assets/{asset_id}/downtime-events", headers=tech1)
    wo_id = reported.json()["work_order"]["id"]
    event_id = reported.json()["event"]["id"]

    client.post(f"/work-orders/{wo_id}/start", headers=tech1)
    completed = client.post(
        f"/work-orders/{wo_id}/complete",
        json={"completion_notes": "fixed"},
        headers=tech1,
    )
    assert completed.status_code == 200
    assert completed.json()["downtime_event"]["id"] == event_id
    assert completed.json()["downtime_event"]["up_at"] is None  # still ongoing

    with db.get_session_factory()() as session:
        event = session.get(models.DowntimeEvent, event_id)
        assert event is not None
        assert event.up_at is None


def test_unknown_work_order_404(client: TestClient, tech1: dict[str, str]) -> None:
    assert client.get("/work-orders/9999", headers=tech1).status_code == 404
    assert (
        client.patch("/work-orders/9999", json={}, headers=tech1).status_code == 404
    )
    for action, body in (
        ("start", None),
        ("complete", {"completion_notes": "x"}),
        ("abandon", {"note": "x"}),
    ):
        response = client.post(
            f"/work-orders/9999/{action}", json=body, headers=tech1
        )
        assert response.status_code == 404, action
