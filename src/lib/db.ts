import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { opcionesConexion } from "@/lib/db-config";

// Se guarda en globalThis para reusar la misma conexión: en desarrollo Next
// recarga los módulos al guardar y sin esto abriría conexiones nuevas cada vez.
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Se crea recién la primera vez que se usa, así el build no necesita las variables.
export function obtenerDb(): PrismaClient {
  if (!globalParaPrisma.prisma) {
    const adapter = new PrismaPg(opcionesConexion(process.env));
    globalParaPrisma.prisma = new PrismaClient({ adapter });
  }
  return globalParaPrisma.prisma;
}
