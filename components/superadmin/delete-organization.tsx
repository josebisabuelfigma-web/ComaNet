"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteOrganization } from "@/lib/actions/superadmin";

export function DeleteOrganization({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const [step, setStep] = React.useState<0 | 1 | 2>(0);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleFinalConfirm() {
    setIsDeleting(true);
    setError(null);
    const result = await deleteOrganization(organizationId);
    if (result?.error) {
      setError(result.error);
      setIsDeleting(false);
      setStep(0);
    }
  }

  return (
    <Card className="border-brand-danger/40">
      <CardHeader>
        <CardTitle className="text-brand-danger">Zona peligrosa</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-brand-muted">
          Elimina permanentemente esta organización: usuarios, catálogo, ventas, clientes,
          facturas y todo su historial. No se puede deshacer.
        </p>
        {error && <p className="text-sm text-brand-danger">{error}</p>}
        <Button
          variant="destructive"
          className="self-start"
          onClick={() => setStep(1)}
        >
          <Trash2 className="h-4 w-4" />
          Eliminar organización
        </Button>
      </CardContent>

      <ConfirmDialog
        open={step === 1}
        onOpenChange={(open) => !open && setStep(0)}
        title={`¿Eliminar "${organizationName}"?`}
        description="Esta acción eliminará el negocio, sus usuarios y todos sus datos. Es irreversible."
        confirmLabel="Continuar"
        cancelLabel="Cancelar"
        onConfirm={() => setStep(2)}
      />

      <ConfirmDialog
        open={step === 2}
        onOpenChange={(open) => !open && setStep(0)}
        title="Confirmación final"
        description={`Última confirmación: se eliminará "${organizationName}" y no habrá forma de recuperar la información. ¿Deseas continuar?`}
        confirmLabel="Sí, eliminar definitivamente"
        loadingLabel="Eliminando..."
        cancelLabel="Cancelar"
        isLoading={isDeleting}
        onConfirm={handleFinalConfirm}
      />
    </Card>
  );
}
