import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UserOut, WorkOrderDetailOut, WorkOrderStatus } from '../api/types';
import { AuthContext } from '../auth/AuthContext';
import { WorkOrderDetailScreen } from './WorkOrderDetailScreen';

const PLANNER: UserOut = { id: 1, username: 'planner1', role: 'planner' };
const TECH: UserOut = { id: 2, username: 'tech1', role: 'user' };

function woFixture(
  status: WorkOrderStatus,
  assignedTo: number | null,
): WorkOrderDetailOut {
  return {
    id: 5,
    asset_id: 1,
    origin: 'manual',
    downtime_event_id: null,
    title: 'Fix the mixer',
    description: null,
    priority: 'medium',
    status,
    created_by: 2,
    assigned_to: assignedTo,
    scheduled_start: null,
    expected_duration_minutes: null,
    completion_notes: null,
    created_at: '2026-07-22T10:00:00',
    updated_at: '2026-07-22T10:00:00',
    downtime_event: null,
    transitions: [],
  };
}

function renderFor(user: UserOut, wo: WorkOrderDetailOut) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(wo), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  return render(
    <AuthContext.Provider
      value={{ user, login: vi.fn(), logout: vi.fn() }}
    >
      <WorkOrderDetailScreen workOrderId={5} navigate={vi.fn()} />
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkOrderDetailScreen action visibility (display-only UX)', () => {
  it('planner on an open WO sees Plan/Start/Cancel, not Complete/Abandon', async () => {
    renderFor(PLANNER, woFixture('open', null));
    expect(await screen.findByRole('button', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel WO' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abandon' })).toBeNull();
  });

  it('user on an open WO sees Start only — no planner affordances', async () => {
    renderFor(TECH, woFixture('open', null));
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel WO' })).toBeNull();
  });

  it('executor on an in-progress WO sees Complete and Abandon', async () => {
    renderFor(TECH, woFixture('in_progress', TECH.id));
    expect(
      await screen.findByRole('button', { name: 'Complete' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abandon' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
  });

  it('non-executor user on an in-progress WO gets no transition actions', async () => {
    renderFor(TECH, woFixture('in_progress', 99));
    expect(
      await screen.findByRole('heading', { name: /Fix the mixer/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abandon' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
  });

  it('non-assignee cannot start a planned WO', async () => {
    renderFor(TECH, woFixture('planned', 99));
    expect(
      await screen.findByRole('heading', { name: /Fix the mixer/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
  });

  it('assignee can start a planned WO', async () => {
    renderFor(TECH, woFixture('planned', TECH.id));
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('terminal WO shows no actions, planner included', async () => {
    renderFor(PLANNER, woFixture('completed', TECH.id));
    expect(
      await screen.findByRole('heading', { name: /Fix the mixer/ }),
    ).toBeInTheDocument();
    for (const name of ['Plan', 'Start', 'Complete', 'Abandon', 'Cancel WO']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });
});
