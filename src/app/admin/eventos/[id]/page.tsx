import { notFound } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { alcanceDe, filtroDeEventos } from "@/lib/auth/alcance";
import { obtenerDb } from "@/lib/db";
import { pesosParaEditar } from "@/lib/dinero";
import type { EventoEditado } from "@/lib/eventos/editor";
import { estadosDeLotes } from "@/lib/eventos/lotes";
import { aFechaLocal } from "@/lib/fechas";
import { liberarVencidas } from "@/lib/ventas/ordenes";

import { simularCompraAccion } from "../acciones";
import { EditorEvento, type InfoLote } from "../editor";
import { SimuladorCompra } from "../simulador";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function PaginaEditarEvento({ params, searchParams }: PageProps<"/admin/eventos/[id]">) {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  const { id } = await params;
  const { guardado } = await searchParams;
  if (!UUID.test(id)) notFound();

  // Si es de otra productora, para este organizador "no existe".
  const delAlcance = { id, ...filtroDeEventos(alcanceDe(usuario)) };
  if (!(await obtenerDb().evento.findFirst({ where: delAlcance, select: { id: true } }))) notFound();
  // Antes de mostrar los números, las reservas vencidas devuelven sus lugares.
  await liberarVencidas(obtenerDb(), id).catch((error: unknown) => console.warn("[liberarVencidas] No se pudo:", error));

  const evento = await obtenerDb().evento.findFirst({
    where: delAlcance,
    include: {
      productora: { select: { nombre: true } },
      tipos: { orderBy: [{ orden: "asc" }, { nombre: "asc" }], include: { lotes: { orderBy: { numero: "asc" } } } },
    },
  });
  if (!evento) notFound();

  const inicial: EventoEditado = {
    nombre: evento.nombre,
    slug: evento.slug,
    fecha: aFechaLocal(evento.fecha),
    lugar: evento.lugar,
    direccion: evento.direccion ?? "",
    descripcion: evento.descripcion ?? "",
    maxPorCompra: String(evento.maxPorCompra),
    cupoCortesias: String(evento.cupoCortesias),
    estado: evento.estado,
    tipos: evento.tipos.map((tipo) => ({
      id: tipo.id,
      nombre: tipo.nombre,
      lotes: tipo.lotes.map((lote) => ({
        id: lote.id,
        nombre: lote.nombre,
        precio: pesosParaEditar(lote.precioCentavos),
        cupo: String(lote.cupo),
      })),
    })),
  };

  const infoLotes: Record<string, InfoLote> = {};
  for (const tipo of evento.tipos) {
    const estados = estadosDeLotes(tipo.lotes);
    for (const lote of tipo.lotes) {
      infoLotes[lote.id] = { vendidas: lote.vendidas, reservadas: lote.reservadas, estado: estados.get(lote.id)! };
    }
  }

  // Al guardar cambia la fecha de actualización: el editor y el simulador
  // arrancan de nuevo con lo guardado. (Cada uno con su propia key: si dos
  // hermanos comparten key, React deja el editor viejo en pantalla.)
  const version = evento.actualizadoEn.toISOString();
  return (
    <>
      <EditorEvento
        key={`editor-${version}`}
        eventoId={evento.id}
        inicial={inicial}
        infoLotes={infoLotes}
        cortesiasEmitidas={evento.cortesiasEmitidas}
        guardado={guardado === "1"}
        productoraNombre={usuario.rol === "ADMIN" ? evento.productora.nombre : undefined}
      />
      <SimuladorCompra
        key={`simulador-${version}`}
        accion={simularCompraAccion.bind(null, evento.id)}
        tipos={evento.tipos.map((tipo) => ({ id: tipo.id, nombre: tipo.nombre }))}
        maxPorCompra={evento.maxPorCompra}
      />
    </>
  );
}
