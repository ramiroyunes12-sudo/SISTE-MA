// Lo que ve el público de un evento (la página /e/<slug>).
//
// Regla: de cada tipo de entrada se muestra SOLO el lote en venta (nombre y
// precio). Nada de cantidades (cupo, vendidas, reservadas) ni de los lotes que
// siguen: el siguiente aparece recién cuando se agota el anterior. Esos datos
// no salen de acá, así no llegan nunca al navegador.
import type { EstadoEvento, PrismaClient } from "@/generated/prisma/client";
import { alcanceDe } from "@/lib/auth/alcance";
import type { UsuarioDeSesion } from "@/lib/auth/sesiones";

import { estadosDeLotes } from "./lotes";

export type LotePublico = { id: string; nombre: string; precioCentavos: number };
// lote: null = agotado (no le queda ningún lote con lugar).
export type TipoPublico = { id: string; nombre: string; lote: LotePublico | null };

type LoteCompleto = {
  id: string;
  numero: number;
  nombre: string;
  precioCentavos: number;
  cupo: number;
  vendidas: number;
  reservadas: number;
};

export function tiposParaElPublico(tipos: { id: string; nombre: string; lotes: LoteCompleto[] }[]): TipoPublico[] {
  return tipos
    .filter((tipo) => tipo.lotes.length > 0)
    .map((tipo) => {
      const estados = estadosDeLotes(tipo.lotes);
      const enVenta = tipo.lotes.find((lote) => estados.get(lote.id) === "EN_VENTA");
      // Campo por campo (no con ...lote): así no se cuelan cupo, vendidas ni reservadas.
      const lote = enVenta ? { id: enVenta.id, nombre: enVenta.nombre, precioCentavos: enVenta.precioCentavos } : null;
      return { id: tipo.id, nombre: tipo.nombre, lote };
    });
}

export type EventoPublico = {
  id: string;
  slug: string;
  nombre: string;
  descripcion: string | null;
  fecha: Date;
  lugar: string;
  direccion: string | null;
  maxPorCompra: number;
  estado: EstadoEvento;
  productora: { id: string; nombre: string; activa: boolean };
  tipos: TipoPublico[];
};

export async function buscarEventoPublico(db: PrismaClient, slug: string): Promise<EventoPublico | null> {
  const evento = await db.evento.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      nombre: true,
      descripcion: true,
      fecha: true,
      lugar: true,
      direccion: true,
      maxPorCompra: true,
      estado: true,
      productora: { select: { id: true, nombre: true, activa: true } },
      tipos: {
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
        select: {
          id: true,
          nombre: true,
          lotes: {
            select: {
              id: true,
              numero: true,
              nombre: true,
              precioCentavos: true,
              cupo: true,
              vendidas: true,
              reservadas: true,
            },
          },
        },
      },
    },
  });
  if (!evento) return null;
  const { tipos, ...datos } = evento;
  return { ...datos, tipos: tiposParaElPublico(tipos) };
}

// El público ve los eventos publicados (o ya finalizados) de productoras activas.
export function loVeElPublico(evento: Pick<EventoPublico, "estado" | "productora">) {
  return evento.estado !== "BORRADOR" && evento.productora.activa;
}

// Vista previa (un borrador, o el evento de una productora desactivada): el
// ADMIN, de todos; un organizador, solo los de su productora.
export function puedeVerVistaPrevia(
  usuario: Pick<UsuarioDeSesion, "rol" | "productora" | "debeCambiarContrasena"> | null,
  evento: Pick<EventoPublico, "productora">,
) {
  if (!usuario || usuario.debeCambiarContrasena || usuario.rol === "VALIDADOR") return false;
  const alcance = alcanceDe(usuario);
  return alcance.todo || alcance.productoraId === evento.productora.id;
}
