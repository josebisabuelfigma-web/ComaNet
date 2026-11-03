"use client";

import * as React from "react";
import { ImagePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ImagePickerProps {
  /** Nombre del campo de archivo dentro del formulario. */
  name: string;
  /** Foto actual (si ya existe). */
  currentUrl?: string | null;
  /** Nombre del campo oculto que pide quitar la foto actual. */
  removeName?: string;
  label?: string;
}

const MAX_SIDE = 1280;
const SKIP_BELOW_BYTES = 600 * 1024;

/** Reduce la imagen (lado mayor 1280 px, JPEG) si pesa mucho; si falla, usa la original. */
async function shrinkImage(file: File): Promise<File> {
  if (file.size <= SKIP_BELOW_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Selector de imagen con vista previa y botón visible (no el input nativo). */
export function ImagePicker({ name, currentUrl, removeName = "removeImage", label = "Foto" }: ImagePickerProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [removed, setRemoved] = React.useState(false);

  React.useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const shown = preview ?? (removed ? null : (currentUrl ?? null));

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const original = input.files?.[0];
    if (!original) return;
    // Las fotos de celular pesan varios MB: se reducen antes de enviarlas.
    const file = await shrinkImage(original);
    if (file !== original) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    }
    setPreview(URL.createObjectURL(file));
    setRemoved(false);
  }

  function handleRemove() {
    if (inputRef.current) inputRef.current.value = "";
    setPreview(null);
    setRemoved(true);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-brand-ink">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-brand-md)] border-2 border-dashed border-brand-border bg-black/[0.03] text-brand-muted transition hover:border-brand hover:text-brand-dark"
          aria-label="Elegir foto"
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-8 w-8" />
          )}
        </button>
        <div className="flex flex-col items-start gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <ImagePlus className="h-4 w-4" />
            {shown ? "Cambiar foto" : "Subir foto"}
          </Button>
          {shown && (
            <Button type="button" variant="ghost" size="sm" onClick={handleRemove}>
              <X className="h-4 w-4" />
              Quitar foto
            </Button>
          )}
          <p className="text-xs text-brand-muted">PNG, JPG o WEBP. Máximo 3 MB.</p>
        </div>
      </div>
      <input ref={inputRef} type="file" name={name} accept="image/png,image/jpeg,image/webp" onChange={handleChange} className="sr-only" />
      {removed && <input type="hidden" name={removeName} value="1" />}
    </div>
  );
}
