// Verificar una entrada por su código: SOLO mira, no la marca usada (eso es
// el escáner de la puerta, escanear.ts, con un UPDATE condicionado).
//
// Primero se revisa la firma (sin tocar la base); después se busca el código
// entre las entradas que el usuario puede ver (las de su productora; el ADMIN,
// todas) y se mira que sea de este evento. De una entrada de otro evento no se
// dice nada más, y una de otra productora es como si no existiera.
import type { PrismaClient } from "@/generated/prisma/client";
import { type Alcance, filtroDeEventos } from "@/lib/auth/alcance";

import { leerCodigo } from "./codigo";

export type DatosEntrada = {
  titular: string | null;
  dni: string | null;
  tipo: string;
  compra: number;
  usadaEn: Date | null;
  validadaPor: { id: string; nombre: string } | null; // quién la escaneó en la puerta
};

export type Verificacion =
  | { resultado: "no_valida"; motivo: "formato" | "firma" | "no_existe" | "otro_evento" }
  | { resultado: "valida" | "usada" | "sin_pagar" | "anulada"; entradaId: string; entrada: DatosEntrada };

export async function verificarCodigo(
  db: PrismaClient,
  eventoId: string,
  alcance: Alcance,
  texto: unknown,
): Promise<Verificacion> {
  const leido = leerCodigo(texto);
  if (!leido.ok) return { resultado: "no_valida", motivo: leido.motivo };

  const entrada = await db.entrada.findFirst({
    where: { codigo: leido.codigo, evento: filtroDeEventos(alcance) },
    select: {
      id: true,
      eventoId: true,
      estado: true,
      titular: true,
      dni: true,
      usadaEn: true,
      validadaPor: { select: { id: true, nombre: true } },
      tipoEntrada: { select: { nombre: true } },
      orden: { select: { numero: true, estado: true } },
    },
  });
  if (!entrada) return { resultado: "no_valida", motivo: "no_existe" };
  if (entrada.eventoId !== eventoId) return { resultado: "no_valida", motivo: "otro_evento" };

  const datos: DatosEntrada = {
    titular: entrada.titular,
    dni: entrada.dni,
    tipo: entrada.tipoEntrada.nombre,
    compra: entrada.orden.numero,
    usadaEn: entrada.usadaEn,
    validadaPor: entrada.validadaPor,
  };
  const entradaId = entrada.id;
  if (entrada.estado === "USADA") return { resultado: "usada", entradaId, entrada: datos };
  if (entrada.estado === "ANULADA" || entrada.orden.estado === "REEMBOLSADA") {
    return { resultado: "anulada", entradaId, entrada: datos };
  }
  if (entrada.estado === "VALIDA" && entrada.orden.estado === "PAGADA") return { resultado: "valida", entradaId, entrada: datos };
  return { resultado: "sin_pagar", entradaId, entrada: datos };
}
