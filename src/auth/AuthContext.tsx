/**
 * In-memory auth state — token + current user live in React state only.
 * No localStorage/sessionStorage: relaunch = re-login (v1 decision).
 * Any 401 from the client clears auth state → login screen.
 *
 * The role here is display-only chrome (FS §2) — the server is the gate.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import * as api from '../api/client';
import type { UserOut } from '../api/types';

export interface AuthState {
  user: UserOut | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null);

  const clearAuth = useCallback(() => {
    api.setAuthToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    api.setUnauthorizedHandler(clearAuth);
    return () => api.setUnauthorizedHandler(null);
  }, [clearAuth]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await api.login(username, password);
    api.setAuthToken(response.token);
    setUser(response.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // The session may already be gone server-side; local state clears
      // regardless — the server remains the gate.
    }
    clearAuth();
  }, [clearAuth]);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
