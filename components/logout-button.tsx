"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function LogoutButton({ className = "" }: { className?: string }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button onClick={handleLogout} className={`flex items-center gap-2 text-sm ${className}`}>
      <LogOut className="h-4 w-4" />
      Cerrar sesión
    </button>
  );
}
