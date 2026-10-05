// Crea un usuario del panel, o le resetea la contraseña si ya existe.
// Le da una contraseña temporal (vence en 72 horas) que tiene que cambiar al entrar.
//
//   npm run usuario -- --email ana@gmail.com --nombre "Ana Gómez" --rol ADMIN
//   npm run usuario -- --email ana@gmail.com            (resetear contraseña)
//
// Usa DATABASE_URL del archivo .env. Con --sql no se conecta a nada: imprime
// el SQL para pegar en el SQL Editor de Supabase (crea o resetea).
import { parseArgs } from "node:util";

import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

import { PrismaClient } from "../src/generated/prisma/client";
import { generarContrasenaTemporal, hashearContrasena } from "../src/lib/auth/contrasenas";
import { darContrasenaTemporal, HORAS_TEMPORAL, normalizarEmail } from "../src/lib/auth/cuentas";
import { opcionesConexion } from "../src/lib/db-config";

config({ quiet: true });

const USO = 'Uso: npm run usuario -- --email ana@gmail.com [--nombre "Ana Gómez" --rol ADMIN|VALIDADOR] [--sql]';

function cortar(mensaje: string): never {
  console.error(mensaje);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    nombre: { type: "string" },
    rol: { type: "string" },
    sql: { type: "boolean", default: false },
  },
});
const email = normalizarEmail(values.email);
const nombre = values.nombre?.trim() ?? "";
const rolTexto = values.rol?.toUpperCase();
if (!/^[^\s@]+@[^\s@]+$/.test(email)) cortar(USO);
if (rolTexto !== undefined && rolTexto !== "ADMIN" && rolTexto !== "VALIDADOR") cortar(USO);
const rolPedido = rolTexto as "ADMIN" | "VALIDADOR" | undefined;

function textoSql(valor: string) {
  return `'${valor.replaceAll("'", "''")}'`;
}

async function imprimirSql() {
  if (!nombre || !rolPedido) cortar("Con --sql hacen falta --nombre y --rol (si el usuario ya existe, no se cambian).");
  const temporal = generarContrasenaTemporal();
  const hash = await hashearContrasena(temporal);
  console.log(`-- Contraseña temporal para ${email}: ${temporal} (vence en ${HORAS_TEMPORAL} horas)`);
  console.log(`insert into entradas.usuarios
  (id, nombre, email, hash_contrasena, rol, debe_cambiar_contrasena, temporal_vence_en, actualizado_en)
values
  (gen_random_uuid(), ${textoSql(nombre)}, ${textoSql(email)}, ${textoSql(hash)}, ${textoSql(rolPedido)}, true,
   now() + interval '${HORAS_TEMPORAL} hours', now())
on conflict (email) do update set
  hash_contrasena = excluded.hash_contrasena, debe_cambiar_contrasena = true,
  temporal_vence_en = excluded.temporal_vence_en, intentos_fallidos = 0, bloqueado_hasta = null,
  actualizado_en = now();
delete from entradas.sesiones
where usuario_id = (select id from entradas.usuarios where email = ${textoSql(email)});`);
}

async function conectarYHacer() {
  const db = new PrismaClient({ adapter: new PrismaPg(opcionesConexion(process.env)) });
  try {
    const existe = await db.usuario.findUnique({ where: { email }, select: { id: true } });
    if (existe && (nombre || rolPedido)) {
      cortar("Ese usuario ya existe: este comando solo le resetea la contraseña (sacá --nombre y --rol).");
    }
    if (!existe && !nombre) cortar("Es un usuario nuevo: falta --nombre.");

    const { usuario, temporal, venceEn } = await darContrasenaTemporal(db, {
      email,
      nombre,
      rol: rolPedido ?? "VALIDADOR",
    });
    console.log(existe ? "Contraseña reseteada." : "Usuario creado.");
    console.log(`  ${usuario.nombre} <${usuario.email}> · ${usuario.rol}`);
    console.log(`  Contraseña temporal: ${temporal}`);
    console.log(`  Vence: ${venceEn.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}`);
    if (usuario.activo) {
      console.log("  Al entrar en /ingresar le va a pedir que elija una propia.");
    } else {
      console.log("  OJO: la cuenta está DESACTIVADA. La temporal no va a servir hasta reactivarla.");
    }
  } finally {
    await db.$disconnect();
  }
}

(values.sql ? imprimirSql() : conectarYHacer()).catch((error) => {
  console.error("[usuario] Falló:", error);
  process.exit(1);
});
