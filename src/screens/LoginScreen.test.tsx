import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthContext';
import { LoginScreen } from './LoginScreen';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillAndSubmit(username: string, password: string): void {
  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: username },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginScreen', () => {
  it('submits credentials to /auth/login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        token: 'tok',
        user: { id: 1, username: 'planner1', role: 'planner' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );
    fillAndSubmit('planner1', 'pw');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/auth\/login$/);
    expect(JSON.parse(String(init.body))).toEqual({
      username: 'planner1',
      password: 'pw',
    });
  });

  it('shows the uniform 401 error text', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(401, { detail: 'invalid username or password' }),
        ),
    );

    render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );
    fillAndSubmit('ghost', 'nope');

    expect(
      await screen.findByText('invalid username or password'),
    ).toBeInTheDocument();
  });
});
