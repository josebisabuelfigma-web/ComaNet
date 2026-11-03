"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createOrganization } from "@/lib/actions/superadmin";

export default function NuevaOrganizacionPage() {
  const [state, formAction, pending] = useActionState(createOrganization, undefined);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/superadmin"
          className="mb-2 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Organizaciones
        </Link>
        <h1 className="text-2xl font-semibold text-brand-ink">Nueva organización</h1>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Datos del negocio y su administrador</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Nombre del negocio</Label>
              <Input id="name" name="name" placeholder="Burger House" required />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slug">Identificador (slug)</Label>
              <Input id="slug" name="slug" placeholder="burger-house" required />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="maxUsuarios">Usuarios incluidos (cajeros, meseros y cocina)</Label>
              <Input
                id="maxUsuarios"
                name="maxUsuarios"
                type="number"
                min={0}
                max={100}
                defaultValue={3}
                required
              />
            </div>

            <hr className="border-brand-border" />
            <p className="text-sm font-medium text-brand-ink">Administrador (owner)</p>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ownerFullName">Nombre completo</Label>
              <Input id="ownerFullName" name="ownerFullName" required />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ownerUsername">Usuario</Label>
              <Input id="ownerUsername" name="ownerUsername" placeholder="ej: carlos.burgerhouse" required />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ownerPassword">Contraseña inicial</Label>
              <Input id="ownerPassword" name="ownerPassword" type="password" required minLength={8} />
            </div>

            {state?.error && <p className="text-sm text-brand-danger">{state.error}</p>}

            <Button type="submit" disabled={pending} className="mt-2 w-fit">
              {pending ? "Creando..." : "Crear organización"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
