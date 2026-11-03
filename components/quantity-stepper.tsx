"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

interface QuantityStepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}

/**
 * Cantidad con botones − / + y caja editable. Permite borrar el número
 * mientras se escribe (en celular) y lo ajusta al salir de la caja.
 */
export function QuantityStepper({ value, min = 1, max = 20, onChange }: QuantityStepperProps) {
  const [text, setText] = React.useState(String(value));

  React.useEffect(() => {
    setText(String(value));
  }, [value]);

  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  function commit() {
    const parsed = parseInt(text, 10);
    const next = Number.isNaN(parsed) ? value : clamp(parsed);
    setText(String(next));
    if (next !== value) onChange(next);
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label="Menos"
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={text}
        onChange={(event) => setText(event.target.value.replace(/\D/g, "").slice(0, 2))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        className="h-8 w-11 rounded-[var(--radius-brand-sm)] border border-brand-border text-center text-sm"
        aria-label="Cantidad"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label="Más"
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
