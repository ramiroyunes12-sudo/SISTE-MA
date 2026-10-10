import Link from "next/link";

import { requerirUsuario } from "@/lib/auth/actual";
import { obtenerDb } from "@/lib/db";
import { formatearFecha } from "@/lib/fechas";

import { AccionesPersona, FormularioAgregarPersona } from "../productoras/formularios";
import { agregarValidadorAccion, cambiarActivoValidadorAccion, nuevaTemporalValidadorAccion } from "./acciones";

// "Validadores": cada organizador suma y maneja a la gente que escanea en la
// puerta de sus eventos. (El dueño lo hace desde Productoras.)
export default async function PaginaValidadores() {
  const usuario = await requerirUsuario(["ORGANIZADOR"]);
  const productora = usuario.productora!;
  const validadores = await obtenerDb().usuario.findMany({
    where: { productoraId: productora.id, rol: "VALIDADOR" },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, email: true, activo: true, debeCambiarContrasena: true, ultimoIngresoEn: true },
  });

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-extrabold">Validadores</h1>
        <p className="text-tenue">
          La gente que escanea las entradas en la puerta. Entran con su email en <strong>/ingresar</strong> desde el celu y
          solo ven el escáner de los eventos de {productora.nombre}. Para escanear vos, usá{" "}
          <Link href="/validar" className="font-semibold text-acento hover:text-acento-hover">
            Abrir escáner
          </Link>
          .
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-borde bg-superficie">
        {validadores.length === 0 ? (
          <p className="p-5 text-sm text-tenue">Todavía no hay validadores. Sumá el primero acá abajo.</p>
        ) : (
          <ul>
            {validadores.map((persona, i) => (
              <li
                key={persona.id}
                className={`flex flex-wrap items-start justify-between gap-3 px-5 py-4 ${i ? "border-t border-[#EDEDE8]" : ""}`}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className={`font-semibold ${persona.activo ? "" : "text-tenue line-through"}`}>{persona.nombre}</span>
                  <span className="text-sm text-tenue [overflow-wrap:anywhere]">{persona.email}</span>
                  <span className="text-xs text-tenue">
                    {!persona.activo
                      ? "Desactivado: no puede entrar"
                      : persona.debeCambiarContrasena
                        ? "Todavía no eligió su contraseña"
                        : persona.ultimoIngresoEn
                          ? `Último ingreso: ${formatearFecha(persona.ultimoIngresoEn)}`
                          : ""}
                  </span>
                </div>
                <AccionesPersona
                  nombre={persona.nombre}
                  activo={persona.activo}
                  nuevaTemporal={nuevaTemporalValidadorAccion.bind(null, persona.id)}
                  cambiarActivo={cambiarActivoValidadorAccion.bind(null, persona.id, !persona.activo)}
                />
              </li>
            ))}
          </ul>
        )}
        <FormularioAgregarPersona accion={agregarValidadorAccion} soloValidadores />
      </section>
    </>
  );
}
