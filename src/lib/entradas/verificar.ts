// Verificar una entrada por su código: SOLO mira, no la marca usada (eso es
// el escáner de la puerta, paso 17, con un UPDATE condicionado).
//
// Primero se revisa la firma (sin tocar la base); después se busca el código
// y se mira que sea de este evento. De una entrada de otro evento no se dice
// nada más.
import type { PrismaClient } from "@/generated/prisma/client";

import { leerCodigo } from "./codigo";

export type DatosEntrada = { titular: string | null; dni: string | null; tipo: string; compra: number; usadaEn: Date | null };

export type Verificacion =
  | { resultado: "no_valida"; motivo: "formato" | "firma" | "no_existe" | "otro_evento" }
  | { resultado: "valida" | "usada" | "sin_pagar" | "anulada"; entrada: DatosEntrada };

export async function verificarCodigo(db: PrismaClient, eventoId: string, texto: unknown): Promise<Verificacion> {
  const leido = leerCodigo(texto);
  if (!leido.ok) return { resultado: "no_valida", motivo: leido.motivo };

  const entrada = await db.entrada.findUnique({
    where: { codigo: leido.codigo },
    select: {
      eventoId: true,
      estado: true,
      titular: true,
      dni: true,
      usadaEn: true,
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
  };
  if (entrada.estado === "USADA") return { resultado: "usada", entrada: datos };
  if (entrada.estado === "ANULADA" || entrada.orden.estado === "REEMBOLSADA") return { resultado: "anulada", entrada: datos };
  if (entrada.estado === "VALIDA" && entrada.orden.estado === "PAGADA") return { resultado: "valida", entrada: datos };
  return { resultado: "sin_pagar", entrada: datos };
}
