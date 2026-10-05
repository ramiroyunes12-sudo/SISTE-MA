"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Secciones del panel. Las que todavía no existen se muestran apagadas.
const SECCIONES: { texto: string; href?: string; paso?: number }[] = [
  { texto: "Resumen", href: "/admin" },
  { texto: "Evento y lotes", paso: 6 },
  { texto: "Ventas", paso: 20 },
  { texto: "Cortesías", paso: 19 },
  { texto: "Validadores", paso: 17 },
];

const base = "flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-[15px]";

export function MenuAdmin() {
  const ruta = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {SECCIONES.map(({ texto, href, paso }) => (
        <li key={texto}>
          {href ? (
            <Link
              href={href}
              aria-current={ruta === href ? "page" : undefined}
              className={`${base} text-[#D6D7DB] no-underline hover:bg-white/10 aria-[current=page]:bg-[#2E313A] aria-[current=page]:font-bold aria-[current=page]:text-white`}
            >
              {texto}
            </Link>
          ) : (
            <span className={`${base} cursor-default text-white/40`} title={`Llega en el paso ${paso}`}>
              {texto}
              <span className="text-xs">pronto</span>
            </span>
          )}
        </li>
      ))}
      <li className="mt-3">
        <Link
          href="/validar"
          className={`${base} border border-[#4A4D57] text-white no-underline hover:bg-white/10`}
        >
          Abrir escáner
        </Link>
      </li>
    </ul>
  );
}
