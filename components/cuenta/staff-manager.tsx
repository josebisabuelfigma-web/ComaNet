"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { createStaff, deleteStaff, resetStaffPassword } from "@/lib/actions/cuenta";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Profile } from "@/lib/supabase/types";

interface StaffManagerProps {
  staff: Profile[];
  maxUsuarios: number;
}

export function StaffManager({ staff, maxUsuarios }: StaffManagerProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Profile | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [resetting, setResetting] = React.useState<Profile | null>(null);
  const [newPassword, setNewPassword] = React.useState("");
  const [resetMessage, setResetMessage] = React.useState<string | null>(null);
  const [state, formAction, pending] = useActionState(createStaff, undefined);
  const formRef = React.useRef<HTMLFormElement>(null);
  const atLimit = staff.length >= maxUsuarios;

  React.useEffect(() => {
    if (state?.success) {
      setOpen(false);
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  async function handleDelete() {
    if (!deleting) return;
    setIsDeleting(true);
    await deleteStaff(deleting.id, deleting.username);
    setIsDeleting(false);
    setDeleting(null);
    router.refresh();
  }

  async function handleReset() {
    if (!resetting) return;
    const result = await resetStaffPassword(resetting.id, newPassword);
    if (result?.error) {
      setResetMessage(result.error);
      return;
    }
    setResetting(null);
    setNewPassword("");
    setResetMessage(null);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Personal</CardTitle>
          <CardDescription>
            {staff.length} de {maxUsuarios} usuarios usados en tu plan (cajeros, meseros y cocina).
          </CardDescription>
        </div>
        <Button onClick={() => setOpen(true)} disabled={atLimit}>
          <Plus className="h-4 w-4" />
          Crear usuario
        </Button>
      </CardHeader>
      <CardContent>
        {staff.length === 0 ? (
          <p className="text-sm text-brand-muted">Aún no has creado cajeros ni meseros.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-brand-border">
            {staff.map((user) => (
              <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium text-brand-ink">{user.full_name}</p>
                  <p className="text-sm text-brand-muted">@{user.username}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="muted">{ROLE_LABELS[user.role]}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Cambiar contraseña"
                    onClick={() => setResetting(user)}
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleting(user)}>
                    <Trash2 className="h-4 w-4 text-brand-danger" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {atLimit && (
          <p className="mt-3 text-sm text-brand-muted">
            Alcanzaste el límite de usuarios de tu plan. Contáctanos si necesitas más.
          </p>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear usuario</DialogTitle>
          </DialogHeader>
          <form ref={formRef} action={formAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role">Rol</Label>
              <select
                id="role"
                name="role"
                required
                defaultValue="mesero"
                className="h-9 rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 text-sm"
              >
                <option value="mesero">Mesero — atiende mesas</option>
                <option value="cajero">Cajero — pedidos, mesas y caja</option>
                <option value="cocina">Cocina — ve y prepara pedidos</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fullName">Nombre completo</Label>
              <Input id="fullName" name="fullName" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Usuario</Label>
              <Input id="username" name="username" required placeholder="ej: juan.perez" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Contraseña inicial</Label>
              <PasswordInput id="password" name="password" required minLength={8} />
            </div>

            {state?.error && <p className="text-sm text-brand-danger">{state.error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creando..." : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!resetting}
        onOpenChange={(value) => {
          if (!value) {
            setResetting(null);
            setNewPassword("");
            setResetMessage(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva contraseña para @{resetting?.username}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <PasswordInput
              minLength={8}
              placeholder="Mínimo 8 caracteres"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            {resetMessage && <p className="text-sm text-brand-danger">{resetMessage}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetting(null)}>
              Cancelar
            </Button>
            <Button onClick={handleReset} disabled={newPassword.length < 8}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(value) => !value && setDeleting(null)}
        title="Eliminar usuario"
        description={`¿Deseas eliminar a "${deleting?.full_name}" (@${deleting?.username})? Perderá el acceso al sistema de inmediato. Esta acción no se puede deshacer.`}
        isLoading={isDeleting}
        onConfirm={handleDelete}
      />
    </Card>
  );
}
