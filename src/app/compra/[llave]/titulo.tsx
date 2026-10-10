"use client";

// "¡Compra confirmada!": se lleva el foco al aparecer (por ejemplo, cuando
// entra el pago con la página abierta), así el lector de pantalla lo lee.
import { type ReactNode, useEffect, useRef } from "react";

export function TituloConFoco({ className, children }: { className?: string; children: ReactNode }) {
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titulo.current?.focus();
  }, []);
  return (
    <h2 ref={titulo} tabIndex={-1} className={`outline-none ${className ?? ""}`}>
      {children}
    </h2>
  );
}
