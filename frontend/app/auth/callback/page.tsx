"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const type = params.get("type");

    if (type === "recovery") {
      router.replace(`/auth/reset-password?code=${code}`);
      return;
    }

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          router.replace("/sign-in");
        } else {
          router.replace("/dashboard");
        }
      });
    } else {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          router.replace("/dashboard");
        } else {
          router.replace("/sign-in");
        }
      });
    }
  }, [router]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
      }}
    >
      <span
        style={{
          color: "var(--muted)",
          fontFamily: "var(--font-geist-mono)",
          fontSize: "0.875rem",
          letterSpacing: "0.05em",
        }}
      >
        authenticating...
      </span>
    </div>
  );
}
