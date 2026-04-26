"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface AuthContextValue {
  isSignedIn: boolean;
  user: User | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) { supabase.auth.signOut(); setSession(null); }
      else setSession(data.session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, []);

  const getToken = async (): Promise<string | null> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        await supabase.auth.signOut();
        window.location.href = "/sign-in";
        return null;
      }
      return data.session?.access_token ?? null;
    } catch {
      await supabase.auth.signOut();
      window.location.href = "/sign-in";
      return null;
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  if (session === undefined) return null;

  return (
    <AuthContext.Provider value={{
      isSignedIn: !!session,
      user: session?.user ?? null,
      getToken,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
