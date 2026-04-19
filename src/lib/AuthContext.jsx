import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      const currentSession = data?.session || null;
      setSession(currentSession);
      setUser(currentSession?.user || null);
      setIsLoadingAuth(false);
    })().catch(() => {
      if (!alive) return;
      setAuthError({ type: 'auth_required' });
      setIsLoadingAuth(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_evt, nextSession) => {
      setSession(nextSession || null);
      setUser(nextSession?.user || null);
    });

    return () => {
      alive = false;
      authListener?.subscription?.unsubscribe?.();
    };
  }, []);

  const value = useMemo(() => ({
    user,
    session,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    navigateToLogin: () => {
      if (typeof window !== 'undefined') window.location.href = '/login.html';
    }
  }), [user, session, isLoadingAuth, isLoadingPublicSettings, authError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
