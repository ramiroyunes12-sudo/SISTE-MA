import Link from "next/link";
import { notFound } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { obtenerDb } from "@/lib/db";
import { formatearFecha } from "@/lib/fechas";

import { cuentaMpDe } from "@/lib/pagos/cuenta";
import { bpsAPorcentaje } from "@/lib/pagos/montos";

import {
  agregarPersonaAccion,
  cambiarActivoAccion,
  conectarMpAccion,
  desconectarMpAccion,
  editarProductoraAccion,
  guardarCobrosAccion,
  nuevaTemporalAccion,
} from "../acciones";
import { FormularioCobros } from "../cobros";
import { AccionesPersona, FormularioAgregarPersona, FormularioEditarProductora } from "../formularios";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROL = { ORGANIZADOR: "Organizador", VALIDADOR: "Validador", ADMIN: "Admin" } as const;
// Primero los organizadores, después los validadores.
const ORDEN_ROL = { ADMIN: 0, ORGANIZADOR: 1, VALIDADOR: 2 } as const;

export default async function PaginaProductora({ params }: PageProps<"/admin/productoras/[id]">) {
  await requerirUsuario(["ADMIN"]);
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const productora = await obtenerDb().productora.findUnique({
    where: { id },
    include: {
      usuarios: {
        orderBy: { nombre: "asc" },
        select: {
          id: true,
          nombre: true,
          email: true,
          rol: true,
          activo: true,
          debeCambiarContrasena: true,
          ultimoIngresoEn: true,
        },
      },
      eventos: { orderBy: { fecha: "desc" }, select: { id: true, nombre: true, fecha: true, estado: true } },
    },
  });
  if (!productora) notFound();
  const personas = [...productora.usuarios].sort((a, b) => ORDEN_ROL[a.rol] - ORDEN_ROL[b.rol]);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/admin/productoras" className="text-sm font-semibold text-acento hover:text-acento-hover">
          ← Productoras
        </Link>
        <h1 className="font-display text-3xl font-extrabold [overflow-wrap:anywhere]">{productora.nombre}</h1>
      </div>

      <FormularioEditarProductora
        accion={editarProductoraAccion.bind(null, productora.id)}
        nombre={productora.nombre}
        activa={productora.activa}
      />

      <FormularioCobros
        guardar={guardarCobrosAccion.bind(null, productora.id)}
        conectar={conectarMpAccion.bind(null, productora.id)}
        desconectar={desconectarMpAccion.bind(null, productora.id)}
        alias={productora.aliasTransferencia ?? ""}
        titular={productora.titularTransferencia ?? ""}
        recargo={bpsAPorcentaje(productora.recargoMpBps)}
        cuentaMp={productora.mpUsuarioId ? (productora.mpCuenta ?? productora.mpUsuarioId) : null}
        conectadaEl={productora.mpConectadaEn ? formatearFecha(productora.mpConectadaEn) : null}
        cuentaIlegible={Boolean(productora.mpUsuarioId) && cuentaMpDe(productora) === null}
      />

      <section className="overflow-hidden rounded-2xl border border-borde bg-superficie">
        <div className="flex flex-col gap-1 p-5">
          <h2 className="text-lg font-bold">Personas</h2>
          <p className="text-sm text-tenue">
            Organizadores: manejan los eventos y ven los números. Validadores: solo escanean en la puerta.
          </p>
        </div>
        <ul>
          {personas.map((persona) => (
            <li
              key={persona.id}
              className="flex flex-wrap items-start justify-between gap-3 border-t border-[#EDEDE8] px-5 py-4"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className={`font-semibold ${persona.activo ? "" : "text-tenue line-through"}`}>{persona.nombre}</span>
                <span className="text-sm text-tenue [overflow-wrap:anywhere]">{persona.email}</span>
                <span className="text-xs text-tenue">
                  {ROL[persona.rol]}
                  {!persona.activo && " · desactivada"}
                  {persona.activo &&
                    (persona.debeCambiarContrasena
                      ? " · todavía no eligió su contraseña"
                      : persona.ultimoIngresoEn
                        ? ` · último ingreso: ${formatearFecha(persona.ultimoIngresoEn)}`
                        : "")}
                </span>
              </div>
              <AccionesPersona
                nombre={persona.nombre}
                activo={persona.activo}
                nuevaTemporal={nuevaTemporalAccion.bind(null, productora.id, persona.id)}
                cambiarActivo={cambiarActivoAccion.bind(null, productora.id, persona.id, !persona.activo)}
              />
            </li>
          ))}
        </ul>
        <FormularioAgregarPersona accion={agregarPersonaAccion.bind(null, productora.id)} />
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-5">
        <h2 className="text-lg font-bold">Eventos</h2>
        {productora.eventos.length === 0 ? (
          <p className="text-sm text-tenue">Todavía no tiene eventos.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {productora.eventos.map((evento) => (
              <li key={evento.id}>
                <Link href={`/admin/eventos/${evento.id}`} className="font-semibold text-acento hover:text-acento-hover">
                  {evento.nombre}
                </Link>{" "}
                <span className="text-sm text-tenue">· {formatearFecha(evento.fecha)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
