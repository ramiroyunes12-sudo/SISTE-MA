// Datos de prueba: una productora y un evento de ejemplo con sus tipos de entrada y lotes.
// Se pueden cargar varias veces: actualiza lo que existe, no duplica.
// OJO: borrar este evento antes de empezar a vender de verdad.
import type { PrismaClient } from "../src/generated/prisma/client";

export const SLUG_EVENTO_PRUEBA = "evento-de-prueba";
export const PRODUCTORA_PRUEBA = "Productora de prueba";

const EVENTO = {
  nombre: "Evento de prueba",
  descripcion: "Evento de ejemplo para probar el sistema. Borrarlo antes de vender de verdad.",
  fecha: new Date("2026-11-21T23:00:00-03:00"), // sábado
  lugar: "Lugar de prueba",
  direccion: "Corrientes, Argentina",
  maxPorCompra: 6,
  cupoCortesias: 50,
  estado: "PUBLICADO" as const,
};

// Precios en pesos (se guardan en centavos). Son los del diseño de ejemplo.
const TIPOS = [
  {
    nombre: "General",
    orden: 1,
    lotes: [
      { numero: 1, precio: 6000, cupo: 300 },
      { numero: 2, precio: 8000, cupo: 200 },
      { numero: 3, precio: 10000, cupo: 150 },
    ],
  },
  {
    nombre: "VIP",
    orden: 2,
    lotes: [{ numero: 1, precio: 15000, cupo: 60 }],
  },
];

export async function cargarDatosDePrueba(db: PrismaClient) {
  const productora = await db.productora.upsert({
    where: { nombre: PRODUCTORA_PRUEBA },
    create: { nombre: PRODUCTORA_PRUEBA },
    update: {},
  });
  const evento = await db.evento.upsert({
    where: { slug: SLUG_EVENTO_PRUEBA },
    create: { slug: SLUG_EVENTO_PRUEBA, productoraId: productora.id, ...EVENTO },
    update: EVENTO,
  });

  let lotes = 0;
  for (const tipo of TIPOS) {
    const tipoEntrada = await db.tipoEntrada.upsert({
      where: { eventoId_nombre: { eventoId: evento.id, nombre: tipo.nombre } },
      create: { eventoId: evento.id, nombre: tipo.nombre, orden: tipo.orden },
      update: { orden: tipo.orden },
    });

    for (const lote of tipo.lotes) {
      const datos = {
        nombre: `Lote ${lote.numero}`,
        precioCentavos: lote.precio * 100,
        cupo: lote.cupo,
      };
      // Solo actualiza nombre, precio y cupo: nunca toca vendidas ni reservadas.
      await db.lote.upsert({
        where: { tipoEntradaId_numero: { tipoEntradaId: tipoEntrada.id, numero: lote.numero } },
        create: { tipoEntradaId: tipoEntrada.id, numero: lote.numero, ...datos },
        update: datos,
      });
      lotes++;
    }
  }

  return { evento: evento.slug, tipos: TIPOS.length, lotes };
}
