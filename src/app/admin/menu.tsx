"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Secciones del panel. Las que todavía no existen se muestran apagadas.
// (El número es el paso del plan en el que se arma cada una.)
const SECCIONES: { texto: string; href?: string; paso?: number; soloAdmin?: boolean }[] = [
  { texto: "Resumen", href: "/admin" },
  { texto: "Productoras", href: "/admin/productoras", soloAdmin: true },
  { texto: "Evento y lotes", href: "/admin/eventos" },
  { texto: "Ventas", paso: 20 },
  { texto: "Cortesías", paso: 19 },
  { texto: "Validadores", href: "/admin/validadores" },
  { texto: "Claves", href: "/admin/claves", soloAdmin: true },
];

const base = "flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-[15px]";

// Marcada si es esa página o una de adentro (/admin/eventos/…); "Resumen" solo exacta.
function esActual(ruta: string, href: string) {
  return ruta === href || (href !== "/admin" && ruta.startsWith(`${href}/`));
}

export function MenuAdmin({ esAdmin }: { esAdmin: boolean }) {
  const ruta = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {SECCIONES.filter((seccion) => esAdmin || !seccion.soloAdmin).map(({ texto, href }) => (
        <li key={texto}>
          {href ? (
            <Link
              href={href}
              aria-current={esActual(ruta, href) ? "page" : undefined}
              className={`${base} text-[#D6D7DB] no-underline hover:bg-white/10 aria-[current=page]:bg-[#2E313A] aria-[current=page]:font-bold aria-[current=page]:text-white`}
            >
              {texto}
            </Link>
          ) : (
            <span className={`${base} cursor-default text-white/40`} title="Próximamente">
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
