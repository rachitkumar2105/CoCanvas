"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/workspaces" : "/login");
  }, [loading, user, router]);

  return <div className="flex h-screen items-center justify-center text-gray-400">Loading…</div>;
}
