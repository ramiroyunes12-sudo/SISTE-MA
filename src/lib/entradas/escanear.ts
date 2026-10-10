// La puerta: leer el QR y, si la entrada es válida, marcarla usada.
//
// Marcarla usada es UN SOLO UPDATE condicionado (la entrada VALIDA, de este
// evento y con la compra PAGADA): si dos celulares escanean el mismo QR a la
// vez, PostgreSQL deja que uno solo la cambie y el otro no encuentra nada que
// cambiar (YA INGRESÓ). Nunca mirar primero y después escribir: así entraban
// las dos. Recién si el UPDATE no cambió nada se mira la entrada, para decir
// por qué no pasa.
//
// Cada escaneo queda anotado en `escaneos` (quién, cuándo, qué dio). De lo
// leído se guarda solo un código con la firma mal, sin la firma, para
// investigar QR truchos: uno bien firmado (por ejemplo, de otro evento) es un
// QR que sirve y no se guarda, y un texto cualquiera puede traer cualquier cosa.
import { type MetodoIngreso, Prisma, type PrismaClient } from "@/generated/prisma/client";
import { type Alcance, filtroDeEventos } from "@/lib/auth/alcance";

import { leerCodigo } from "./codigo";
import { verificarEntrada } from "./verificar";

export type DatosPuerta = { titular: string | null; dni: string | null; tipo: string; compra: number };

export type MotivoNoValida = "formato" | "firma" | "no_existe" | "otro_evento" | "sin_pagar" | "anulada";

export type Escaneado =
  | { resultado: "pasa"; entrada: DatosPuerta }
  | {
      resultado: "ya_ingreso";
      entrada: DatosPuerta;
      usadaEn: Date | null;
      validadaPor: { id: string; nombre: string } | null;
      metodo: MetodoIngreso | null; // cómo entró: con el QR o buscada por DNI o nombre
    }
  | { resultado: "no_valida"; motivo: MotivoNoValida; entrada?: DatosPuerta };

// Si entre el UPDATE y la consulta la entrada pasó a válida (por ejemplo, se
// acreditó el pago justo), se vuelve a probar; más de esto, error.
const INTENTOS = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Pedido = { eventoId: string; alcance: Alcance; usuarioId: string; ahora?: Date };

// null si el evento no existe o no es de quien escanea (su productora; el
// ADMIN, todos): no se toca ni se anota nada.
export async function escanearCodigo(db: PrismaClient, pedido: Pedido & { texto: unknown }): Promise<Escaneado | null> {
  const { eventoId, alcance, usuarioId, texto } = pedido;
  if (!(await esDeLaPuerta(db, eventoId, alcance))) return null;

  const leido = leerCodigo(texto);
  if (!leido.ok) {
    // Solo "E1-<al azar>", sin la firma: si se tipeó mal un carácter de la
    // parte al azar, la firma es la verdadera de otra entrada (con la base
    // sola se podría volver a armar su QR). La parte al azar no agrega nada:
    // las de verdad ya están en la base.
    const sinFirma = leido.motivo === "firma" && typeof texto === "string";
    await db.escaneo.create({
      data: {
        eventoId,
        usuarioId,
        metodo: "QR",
        resultado: "NO_VALIDA",
        codigoLeido: sinFirma ? texto.trim().toUpperCase().split("-").slice(0, 2).join("-") : null,
      },
    });
    return { resultado: "no_valida", motivo: leido.motivo };
  }
  return marcar(db, pedido, "QR", { codigo: leido.codigo });
}

// Marcar el ingreso sin el QR, desde la búsqueda por DNI o nombre (quién
// puede: puedeMarcarSinQr, en puerta.ts). El mismo UPDATE condicionado que el
// escáner, por id de entrada, y queda anotado como "DNI" en `escaneos`.
export async function marcarEntrada(db: PrismaClient, pedido: Pedido & { entradaId: string }): Promise<Escaneado | null> {
  if (!(await esDeLaPuerta(db, pedido.eventoId, pedido.alcance))) return null;
  if (!UUID.test(pedido.entradaId)) {
    await db.escaneo.create({
      data: { eventoId: pedido.eventoId, usuarioId: pedido.usuarioId, metodo: "DNI", resultado: "NO_VALIDA" },
    });
    return { resultado: "no_valida", motivo: "no_existe" };
  }
  return marcar(db, pedido, "DNI", { id: pedido.entradaId });
}

async function esDeLaPuerta(db: PrismaClient, eventoId: string, alcance: Alcance) {
  return !!(await db.evento.findFirst({ where: { id: eventoId, ...filtroDeEventos(alcance) }, select: { id: true } }));
}

async function marcar(
  db: PrismaClient,
  { eventoId, alcance, usuarioId, ahora = new Date() }: Pedido,
  metodo: MetodoIngreso,
  donde: { codigo: string } | { id: string },
): Promise<Escaneado> {
  const anotar = (resultado: "YA_INGRESO" | "NO_VALIDA", entradaId: string | null) =>
    db.escaneo.create({ data: { eventoId, entradaId, usuarioId, metodo, resultado } });
  const esta = "codigo" in donde ? Prisma.sql`e.codigo = ${donde.codigo}` : Prisma.sql`e.id = ${donde.id}::uuid`;

  for (let intento = 0; intento < INTENTOS; intento++) {
    const pasada = await db.$transaction(async (tx) => {
      const [marcada] = await tx.$queryRaw<(DatosPuerta & { id: string })[]>`
        UPDATE entradas.entradas AS e
        SET estado = 'USADA', usada_en = ${ahora}, validada_por_id = ${usuarioId}::uuid, actualizado_en = ${ahora}
        FROM entradas.ordenes AS o, entradas.tipos_entrada AS t
        WHERE ${esta}
          AND e.evento_id = ${eventoId}::uuid
          AND e.estado = 'VALIDA'
          AND o.id = e.orden_id AND o.estado = 'PAGADA'
          AND t.id = e.tipo_entrada_id
        RETURNING e.id, e.titular, e.dni, t.nombre AS tipo, o.numero AS compra`;
      if (!marcada) return null;
      await tx.escaneo.create({ data: { eventoId, entradaId: marcada.id, usuarioId, metodo, resultado: "PASA" } });
      return marcada;
    });
    if (pasada) {
      const { titular, dni, tipo, compra } = pasada;
      return { resultado: "pasa", entrada: { titular, dni, tipo, compra } };
    }

    // No cambió nada: ¿por qué?
    const v = await verificarEntrada(db, eventoId, alcance, donde);
    if (v.resultado === "valida") continue; // pasó a válida recién: otra vez
    if (v.resultado === "no_valida") {
      await anotar("NO_VALIDA", null);
      return { resultado: "no_valida", motivo: v.motivo };
    }
    const { usadaEn, validadaPor, metodo: entroCon, ...entrada } = v.entrada;
    if (v.resultado === "usada") {
      await anotar("YA_INGRESO", v.entradaId);
      return { resultado: "ya_ingreso", entrada, usadaEn, validadaPor, metodo: entroCon };
    }
    await anotar("NO_VALIDA", v.entradaId);
    return { resultado: "no_valida", motivo: v.resultado, entrada };
  }
  throw new Error("La entrada cambió de estado mientras se escaneaba");
}

// Un evento sigue en la puerta hasta 24 horas después de empezar (las fiestas
// terminan de madrugada).
const HORAS_EN_LA_PUERTA = 24;

// Los eventos para elegir en la puerta: los de su productora (el ADMIN, todos)
// que todavía no pasaron, del más cercano al más lejano.
export function eventosDeLaPuerta(db: PrismaClient, alcance: Alcance, ahora = new Date()) {
  return db.evento.findMany({
    where: { ...filtroDeEventos(alcance), fecha: { gte: new Date(ahora.getTime() - HORAS_EN_LA_PUERTA * 60 * 60 * 1000) } },
    orderBy: { fecha: "asc" },
    select: { id: true, nombre: true, fecha: true, lugar: true, estado: true, productora: { select: { nombre: true } } },
  });
}
