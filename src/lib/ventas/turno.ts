// El "turno" de un evento: las compras, liberaciones, confirmaciones y
// ediciones de un mismo evento pasan de a una, en el orden en que llegan.
//
// Es un bloqueo "consultivo" de PostgreSQL (advisory lock) que se suelta solo
// al terminar la transacción. A diferencia de bloquear la fila del evento,
// hace fila justa: si alguien espera para editar el evento, las compras que
// llegan después esperan detrás de él (con la fila del evento, una ola de
// compras podía dejar esperando para siempre a quien edita).
//
// Reglas:
// - Una transacción toca un solo evento. Si tomara el turno de dos eventos,
//   se podría trabar con otra que los tome al revés.
// - Quien espera más de `esperaMaximaMs` recibe un error (ver esperoDemasiado
//   en src/lib/errores-db.ts) y la transacción se deshace sin cambiar nada.
//   Ese límite vale hasta que termina la transacción.
import type { Prisma } from "@/generated/prisma/client";

export async function tomarTurnoDelEvento(tx: Prisma.TransactionClient, eventoId: string, esperaMaximaMs: number) {
  await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${Math.round(esperaMaximaMs)}ms`}, true)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evento:${eventoId}`}, 0))`;
}
