// Para traducir errores de la base a mensajes para la persona.
import { Prisma } from "@/generated/prisma/client";

// Si el error es por un dato repetido (regla UNIQUE), el nombre de esa regla
// ("usuarios_email_key", "eventos_slug_key"…). Si no, null.
// (No sirve buscar en el texto del error: incluye el pedazo de código que lo causó.)
export function unicoRepetido(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const meta = error.meta as { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } }; target?: unknown };
  const indice = meta?.driverAdapterError?.cause?.constraint?.index;
  if (typeof indice === "string") return indice;
  return Array.isArray(meta?.target) ? meta.target.join("_") : null;
}

// El código de error de PostgreSQL ("55P03", "40P01"…), si lo hay.
function codigoPostgres(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const meta = error.meta as { driverAdapterError?: { cause?: { originalCode?: unknown } } } | undefined;
  const codigo = meta?.driverAdapterError?.cause?.originalCode;
  return typeof codigo === "string" ? codigo : null;
}

// Esperó su turno más de lo permitido (mucha gente comprando el mismo evento
// a la vez): no se cambió nada y se puede volver a probar.
export function esperoDemasiado(error: unknown) {
  return codigoPostgres(error) === "55P03";
}
