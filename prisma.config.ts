// Configuración de la herramienta de Prisma (comandos `npx prisma ...`).
// El sistema en sí se conecta desde src/lib/db.ts.
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Para crear y modificar tablas se usa la conexión directa
    // (Session pooler de Supabase, puerto 5432).
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
