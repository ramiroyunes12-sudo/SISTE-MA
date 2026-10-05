// Carga los datos de prueba: `npx prisma db seed`
// Usa DATABASE_URL (la misma conexión que el sistema).
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { opcionesConexion } from "../src/lib/db-config";
import { cargarDatosDePrueba } from "./datos-prueba";

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg(opcionesConexion(process.env)) });
  try {
    const resultado = await cargarDatosDePrueba(db);
    console.log(
      `[seed] Listo: evento "${resultado.evento}" con ${resultado.tipos} tipos de entrada y ${resultado.lotes} lotes.`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("[seed] Falló:", error);
  process.exit(1);
});
