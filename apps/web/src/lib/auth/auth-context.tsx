'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api, getTenantId, setTenantId, setToken, getToken } from '@/lib/api/client';
import {
  can,
  type AuthUser,
  type Permission,
} from '@/lib/auth/permissions';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  tenantId: string | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  selectTenant: (tenantId: string) => void;
  can: (permission: Permission) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantIdState] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      setUser(me);
      const stored = getTenantId();
      const valid =
        stored && me.memberships.some((m) => m.tenantId === stored)
          ? stored
          : (me.memberships[0]?.tenantId ?? null);
      setTenantId(valid);
      setTenantIdState(valid);
    } catch {
      setToken(null);
      setTenantId(null);
      setUser(null);
      setTenantIdState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    setToken(res.accessToken);
    setUser(res.user);
    const first = res.user.memberships[0]?.tenantId ?? null;
    setTenantId(first);
    setTenantIdState(first);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setToken(null);
      setTenantId(null);
      setUser(null);
      setTenantIdState(null);
    }
  }, []);

  const selectTenant = useCallback((id: string) => {
    setTenantId(id);
    setTenantIdState(id);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      tenantId,
      login,
      logout,
      refresh,
      selectTenant,
      can: (permission) => can(user, permission, tenantId),
    }),
    [user, loading, tenantId, login, logout, refresh, selectTenant],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
