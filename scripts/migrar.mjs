// Aplica las migraciones pendientes de la base de datos antes del build.
// Solo corre en el deploy de producción de Vercel: los deploys de prueba
// (preview) y tu compu no tocan las tablas.
import { execSync } from "node:child_process";

if (process.env.VERCEL_ENV === "production") {
  console.log("[migrar] Producción: aplicando migraciones pendientes...");
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
} else {
  console.log("[migrar] No es producción: no se aplican migraciones.");
}
