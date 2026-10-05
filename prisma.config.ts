// Configuración de la herramienta de Prisma (comandos `npx prisma ...`).
// El sistema en sí se conecta desde src/lib/db.ts.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "dotenv";
import { defineConfig } from "prisma/config";

import { urlMigraciones } from "./src/lib/db-config";

config({ quiet: true });

function guardarCertificado(pem: string) {
  const ruta = join(tmpdir(), "entradas-db-ca.crt");
  writeFileSync(ruta, pem);
  return ruta;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Para crear y modificar tablas se usa la conexión directa
    // (Session pooler de Supabase, puerto 5432), nunca DATABASE_URL.
    url: urlMigraciones(process.env, guardarCertificado),
  },
});
