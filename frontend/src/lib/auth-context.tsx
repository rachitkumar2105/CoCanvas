"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, setAccessToken, setUnauthorizedHandler } from "./api";
import type { AuthResponse } from "./types";

interface AuthUser {
  userId: string;
  name: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toUser(auth: AuthResponse): AuthUser {
  return { userId: auth.userId, name: auth.name, email: auth.email };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    // On first load there's no access token in memory yet — silently try the
    // httpOnly refresh cookie before deciding the user is signed out (Section 8).
    api
      .refresh()
      .then((auth) => {
        setAccessToken(auth.accessToken);
        setUser(toUser(auth));
      })
      .catch(() => setAccessToken(null))
      .finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const auth = await api.login(email, password);
    setAccessToken(auth.accessToken);
    setUser(toUser(auth));
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const auth = await api.register(name, email, password);
    setAccessToken(auth.accessToken);
    setUser(toUser(auth));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
