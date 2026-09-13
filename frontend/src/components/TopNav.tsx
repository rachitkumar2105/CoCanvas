"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function TopNav() {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <Link href="/workspaces" className="text-lg font-bold text-gray-900">
        CoCanvas
      </Link>
      {user && (
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <span>{user.name}</span>
          <button
            onClick={async () => {
              await logout();
              router.push("/login");
            }}
            className="rounded-md border border-gray-200 px-2.5 py-1 text-gray-600 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
