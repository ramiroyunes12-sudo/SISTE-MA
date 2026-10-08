// Los datos de cobro de cada productora: alias para transferencias, a nombre
// de quién está, el cargo por servicio de Mercado Pago y la cuenta de Mercado
// Pago conectada (su Access Token se guarda cifrado; ver src/lib/cifrado.ts).
//
// Por ahora la cuenta la conecta el ADMIN pegando el Access Token de la
// productora. Más adelante, cada productora con un botón (OAuth).
import type { PrismaClient } from "@/generated/prisma/client";
import { cifrar, descifrar } from "@/lib/cifrado";

import { ErrorMercadoPago, type ApiMercadoPago } from "./mercadopago";
import { porcentajeABps } from "./montos";

export type Errores = Record<string, string>;

const ALIAS = /^[a-z0-9.-]{6,20}$/;
const CVU = /^\d{22}$/;
// Los Access Token de Mercado Pago: "APP_USR-…" (o "TEST-…" en las cuentas de prueba viejas).
const TOKEN = /^(APP_USR|TEST)-[A-Za-z0-9-]{20,200}$/;

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

export function validarDatosCobro(entrada: { alias?: unknown; titular?: unknown; recargo?: unknown }) {
  const errores: Errores = {};
  const crudo = texto(entrada.alias);
  const alias = CVU.test(crudo.replace(/\s/g, "")) ? crudo.replace(/\s/g, "") : crudo.toLowerCase();
  if (alias && !ALIAS.test(alias) && !CVU.test(alias)) {
    errores.alias = "Poné el alias (6 a 20 letras, números, puntos o guiones) o el CVU (22 números).";
  }
  const titular = texto(entrada.titular).replace(/\s+/g, " ");
  if (alias && (titular.length < 2 || titular.length > 80)) errores.titular = "Poné a nombre de quién está la cuenta.";
  if (!alias && titular) errores.alias = "Falta el alias.";
  const recargoBps = porcentajeABps(entrada.recargo);
  if (recargoBps === null) errores.recargo = "Poné un porcentaje de 0 a 20 (por ejemplo, 4,4).";
  if (Object.keys(errores).length) return { ok: false as const, errores };
  return {
    ok: true as const,
    datos: { aliasTransferencia: alias || null, titularTransferencia: alias ? titular : null, recargoMpBps: recargoBps! },
  };
}

export async function guardarDatosCobro(
  db: PrismaClient,
  productoraId: string,
  entrada: { alias?: unknown; titular?: unknown; recargo?: unknown },
) {
  const revision = validarDatosCobro(entrada);
  if (!revision.ok) return revision;
  const { count } = await db.productora.updateMany({ where: { id: productoraId }, data: revision.datos });
  if (count !== 1) return { ok: false as const, errores: { general: "Esa productora ya no existe." } as Errores };
  return revision;
}

// Revisa el token con Mercado Pago (de quién es) y lo guarda cifrado.
export async function conectarMercadoPago(
  db: PrismaClient,
  productoraId: string,
  tokenCrudo: unknown,
  api: ApiMercadoPago,
  ahora = new Date(),
): Promise<{ ok: true; cuenta: string } | { ok: false; error: string }> {
  const token = texto(tokenCrudo);
  if (!TOKEN.test(token)) return { ok: false, error: "Eso no parece un Access Token de Mercado Pago (empieza con APP_USR-)." };
  let cuenta: { id: string; nombre: string };
  try {
    cuenta = await api.cuenta(token);
  } catch (error) {
    if (error instanceof ErrorMercadoPago && (error.status === 401 || error.status === 403)) {
      return { ok: false, error: "Mercado Pago no aceptó ese Access Token. Revisá que sea el de producción y esté completo." };
    }
    return { ok: false, error: "No pudimos hablar con Mercado Pago. Probá de nuevo en un rato." };
  }
  if (!/^\d+$/.test(cuenta.id)) return { ok: false, error: "Mercado Pago no dijo de quién es la cuenta." };
  const { count } = await db.productora.updateMany({
    where: { id: productoraId },
    data: {
      mpUsuarioId: cuenta.id,
      mpCuenta: cuenta.nombre.slice(0, 120),
      mpTokenCifrado: cifrar(token, `mp-token:${productoraId}`),
      mpConectadaEn: ahora,
      mpRevisadoEn: null,
    },
  });
  if (count !== 1) return { ok: false, error: "Esa productora ya no existe." };
  return { ok: true, cuenta: cuenta.nombre };
}

export async function desconectarMercadoPago(db: PrismaClient, productoraId: string) {
  await db.productora.updateMany({
    where: { id: productoraId },
    data: { mpUsuarioId: null, mpCuenta: null, mpTokenCifrado: null, mpConectadaEn: null },
  });
}

export type CuentaMp = { productoraId: string; mpUsuarioId: string; token: string };

// La cuenta conectada de una productora, con el token ya descifrado (null si no tiene).
export function cuentaMpDe(productora: {
  id: string;
  mpUsuarioId: string | null;
  mpTokenCifrado: string | null;
}): CuentaMp | null {
  if (!productora.mpUsuarioId || !productora.mpTokenCifrado) return null;
  return {
    productoraId: productora.id,
    mpUsuarioId: productora.mpUsuarioId,
    token: descifrar(productora.mpTokenCifrado, `mp-token:${productora.id}`),
  };
}
