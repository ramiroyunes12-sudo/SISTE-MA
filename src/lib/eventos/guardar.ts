// Guarda lo que se cargó en "Evento y lotes": el evento, sus tipos de entrada
// y sus lotes, todo junto (si algo falla, no queda nada a medias).
//
// Nunca toca "vendidas" ni "reservadas": esas las mueven las ventas. Y no deja
// achicar un cupo por debajo de lo vendido ni quitar algo que ya tiene entradas
// (además lo frena la propia base).
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { type Alcance, filtroDeEventos } from "@/lib/auth/alcance";
import { unicoRepetido } from "@/lib/errores-db";

import type { Errores, EventoValidado } from "./editor";

export type ResultadoGuardar = { ok: true; id: string } | { ok: false; errores: Errores };

class ErrorDeGuardado extends Error {
  constructor(public errores: Errores) {
    super("No se pudo guardar el evento");
  }
}

const DESACTUALIZADO = "Alguien cambió este evento mientras lo editabas. Recargá la página y volvé a cargar tus cambios.";

// "fiesta" está usado → "fiesta-2", "fiesta-3"…
async function slugLibre(tx: Prisma.TransactionClient, base: string) {
  const usados = new Set(
    (await tx.evento.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((e) => e.slug),
  );
  if (!usados.has(base)) return base;
  let n = 2;
  while (usados.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

async function guardarEnTransaccion(
  tx: Prisma.TransactionClient,
  eventoId: string | null,
  datos: EventoValidado,
  alcance: Alcance,
): Promise<string> {
  // Primero se bloquea el evento: si alguien está comprando, se espera a que
  // termine, y nadie compra hasta que esto se guarde. Así los números de
  // vendidas y reservadas que se leen abajo no cambian en el medio (ver
  // src/lib/ventas/reservas.ts).
  if (eventoId) {
    await tx.$queryRaw`SELECT id FROM entradas.eventos WHERE id = ${eventoId}::uuid FOR UPDATE`;
  }
  // Solo se encuentra si es de la productora de quien edita (el ADMIN, cualquiera).
  const actual = eventoId
    ? await tx.evento.findFirst({
        where: { id: eventoId, ...filtroDeEventos(alcance) },
        include: {
          tipos: {
            include: {
              _count: { select: { entradas: true } },
              lotes: { include: { _count: { select: { entradas: true } } } },
            },
          },
        },
      })
    : null;
  if (eventoId && !actual) throw new ErrorDeGuardado({ general: "Ese evento ya no existe." });

  // ─── El evento ───
  const datosEvento = {
    nombre: datos.nombre,
    fecha: datos.fecha,
    lugar: datos.lugar,
    direccion: datos.direccion,
    descripcion: datos.descripcion,
    maxPorCompra: datos.maxPorCompra,
    cupoCortesias: datos.cupoCortesias,
    estado: datos.estado,
  };
  let id: string;
  if (actual) {
    if (datos.cupoCortesias < actual.cortesiasEmitidas) {
      throw new ErrorDeGuardado({
        cupoCortesias: `Ya se dieron ${actual.cortesiasEmitidas} cortesías: el cupo no puede ser menor.`,
      });
    }
    // Si borraron la dirección, queda la que tenía.
    const slug = datos.slugAutomatico ? actual.slug : datos.slug;
    await tx.evento.update({ where: { id: actual.id }, data: { ...datosEvento, slug } });
    id = actual.id;
  } else {
    // Un organizador crea para su productora; el ADMIN, para la que elija (activa).
    const productoraId = alcance.todo ? datos.productoraId : alcance.productoraId;
    const productora = productoraId
      ? await tx.productora.findFirst({ where: { id: productoraId, activa: true }, select: { id: true } })
      : null;
    if (!productora) throw new ErrorDeGuardado({ productoraId: "Elegí una productora." });
    const slug = datos.slugAutomatico ? await slugLibre(tx, datos.slug) : datos.slug;
    id = (await tx.evento.create({ data: { ...datosEvento, slug, productoraId: productora.id }, select: { id: true } })).id;
  }

  // ─── Que todo lo que se manda sea de este evento ───
  const tiposActuales = new Map((actual?.tipos ?? []).map((tipo) => [tipo.id, tipo]));
  for (const tipo of datos.tipos) {
    const previo = tipo.id ? tiposActuales.get(tipo.id) : undefined;
    if (tipo.id && !previo) throw new ErrorDeGuardado({ general: DESACTUALIZADO });
    for (const lote of tipo.lotes) {
      if (lote.id && !previo?.lotes.some((l) => l.id === lote.id)) {
        throw new ErrorDeGuardado({ general: DESACTUALIZADO });
      }
    }
  }

  // ─── Tipos que se quitaron ───
  const tiposQueQuedan = new Set(datos.tipos.map((tipo) => tipo.id).filter(Boolean));
  for (const tipo of tiposActuales.values()) {
    if (tiposQueQuedan.has(tipo.id)) continue;
    if (tipo._count.entradas > 0 || tipo.lotes.some((l) => l.vendidas + l.reservadas > 0)) {
      throw new ErrorDeGuardado({
        general: `No se puede quitar "${tipo.nombre}": ya tiene entradas vendidas, reservadas o regaladas.`,
      });
    }
    await tx.tipoEntrada.delete({ where: { id: tipo.id } }); // sus lotes se van con él
  }

  // Los que cambian de nombre pasan por un nombre provisorio: así se pueden
  // intercambiar dos nombres ("General" ↔ "Campo") sin chocar.
  for (const tipo of datos.tipos) {
    const previo = tipo.id ? tiposActuales.get(tipo.id) : undefined;
    if (previo && previo.nombre !== tipo.nombre) {
      await tx.tipoEntrada.update({ where: { id: previo.id }, data: { nombre: `~${previo.id}` } });
    }
  }

  // ─── Tipos y lotes, en el orden de la pantalla ───
  for (const [t, tipo] of datos.tipos.entries()) {
    const previo = tipo.id ? tiposActuales.get(tipo.id) : undefined;
    const tipoId = previo
      ? (await tx.tipoEntrada.update({
          where: { id: previo.id },
          data: { nombre: tipo.nombre, orden: tipo.orden },
          select: { id: true },
        })).id
      : (await tx.tipoEntrada.create({
          data: { eventoId: id, nombre: tipo.nombre, orden: tipo.orden },
          select: { id: true },
        })).id;

    const lotesActuales = previo?.lotes ?? [];
    const lotesQueQuedan = new Set(tipo.lotes.map((lote) => lote.id).filter(Boolean));
    for (const lote of lotesActuales) {
      if (lotesQueQuedan.has(lote.id)) continue;
      if (lote.vendidas + lote.reservadas > 0 || lote._count.entradas > 0) {
        throw new ErrorDeGuardado({
          [`tipos.${t}.nombre`]: `No se puede quitar "${lote.nombre}": ya tiene entradas vendidas o reservadas.`,
        });
      }
      // Solo si sigue sin ventas ni reservas (además del bloqueo de arriba).
      const { count } = await tx.lote.deleteMany({ where: { id: lote.id, vendidas: 0, reservadas: 0 } });
      if (count !== 1) throw new ErrorDeGuardado({ general: DESACTUALIZADO });
    }

    // Los lotes nuevos van al final, con el número que sigue.
    let siguiente =
      Math.max(0, ...lotesActuales.filter((lote) => lotesQueQuedan.has(lote.id)).map((lote) => lote.numero)) + 1;
    for (const [l, lote] of tipo.lotes.entries()) {
      const datosLote = { nombre: lote.nombre, precioCentavos: lote.precioCentavos, cupo: lote.cupo };
      const anterior = lote.id ? lotesActuales.find((x) => x.id === lote.id) : undefined;
      if (anterior) {
        const ocupadas = anterior.vendidas + anterior.reservadas;
        if (lote.cupo < ocupadas) {
          throw new ErrorDeGuardado({
            [`tipos.${t}.lotes.${l}.cupo`]: `Ya hay ${ocupadas} vendidas o reservadas: el cupo no puede ser menor.`,
          });
        }
        await tx.lote.update({ where: { id: anterior.id }, data: datosLote });
      } else {
        await tx.lote.create({ data: { ...datosLote, tipoEntradaId: tipoId, numero: siguiente++ } });
      }
    }
  }

  return id;
}

export async function guardarEvento(
  db: PrismaClient,
  eventoId: string | null,
  datos: EventoValidado,
  alcance: Alcance,
): Promise<ResultadoGuardar> {
  try {
    const id = await db.$transaction((tx) => guardarEnTransaccion(tx, eventoId, datos, alcance), {
      timeout: 20_000,
    });
    return { ok: true, id };
  } catch (error) {
    if (error instanceof ErrorDeGuardado) return { ok: false, errores: error.errores };
    const mensaje = error instanceof Error ? error.message : "";
    const repetido = unicoRepetido(error);
    if (repetido) {
      return repetido === "eventos_slug_key"
        ? { ok: false, errores: { slug: "Ya hay otro evento con esa dirección. Elegí otra." } }
        : { ok: false, errores: { general: "Hay dos tipos de entrada con el mismo nombre." } };
    }
    // Reglas de la base: si entre que se cargó la pantalla y se guardó se
    // vendieron entradas, un cupo puede haber quedado por debajo de lo vendido.
    if (mensaje.includes("lotes_numeros_validos")) {
      return {
        ok: false,
        errores: { general: "Mientras editabas se vendieron entradas. Recargá la página y revisá los cupos." },
      };
    }
    if (mensaje.includes("eventos_numeros_validos")) {
      return { ok: false, errores: { cupoCortesias: "El cupo de cortesías no puede ser menor a las ya dadas." } };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return { ok: false, errores: { general: "No se puede quitar algo que ya tiene entradas." } };
    }
    throw error;
  }
}
