// Crea un usuario del panel, o le resetea la contraseña si ya existe.
// Le da una contraseña temporal que tiene que cambiar al entrar.
//
//   npm run usuario -- --email ana@gmail.com --nombre "Ana Gómez" --rol ADMIN
//   npm run usuario -- --email ana@gmail.com            (resetear contraseña)
//
// Usa DATABASE_URL del archivo .env.
import { parseArgs } from "node:util";

import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

import { PrismaClient } from "../src/generated/prisma/client";
import { darContrasenaTemporal, normalizarEmail } from "../src/lib/auth/cuentas";
import { opcionesConexion } from "../src/lib/db-config";

config({ quiet: true });

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, nombre: { type: "string" }, rol: { type: "string" } },
  });
  const email = normalizarEmail(values.email);
  const rol = (values.rol ?? "VALIDADOR").toUpperCase();
  if (!email.includes("@") || (rol !== "ADMIN" && rol !== "VALIDADOR")) {
    console.error('Uso: npm run usuario -- --email ana@gmail.com --nombre "Ana Gómez" --rol ADMIN|VALIDADOR');
    process.exit(1);
  }

  const db = new PrismaClient({ adapter: new PrismaPg(opcionesConexion(process.env)) });
  try {
    const existe = await db.usuario.findUnique({ where: { email }, select: { id: true } });
    if (!existe && !values.nombre?.trim()) {
      console.error("Es un usuario nuevo: falta --nombre.");
      process.exit(1);
    }
    const { usuario, temporal } = await darContrasenaTemporal(db, { email, nombre: values.nombre ?? "", rol });
    console.log(existe ? "Contraseña reseteada." : "Usuario creado.");
    console.log(`  ${usuario.nombre} <${usuario.email}> · ${usuario.rol}${usuario.activo ? "" : " · DESACTIVADO"}`);
    console.log(`  Contraseña temporal: ${temporal}`);
    console.log("  Al entrar en /ingresar le va a pedir que elija una propia.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("[usuario] Falló:", error);
  process.exit(1);
});
