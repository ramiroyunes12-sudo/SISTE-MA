// El código de cada entrada (el que va dentro del QR).
//
// Formato: E1-<AL AZAR>-<FIRMA>, en hexadecimal con mayúsculas (así el QR usa
// el modo "alfanumérico", que da un QR más chico y fácil de leer):
// - E1: versión de la clave. Si algún día hay que cambiarla, las entradas
//   nuevas salen con E2 y las viejas se pueden seguir leyendo mientras tanto.
// - AL AZAR: 128 bits de crypto.randomBytes. Es lo único que se guarda en la
//   base (entradas.codigo), con un índice único.
// - FIRMA: HMAC-SHA256 del número al azar (los primeros 128 bits), con una
//   clave que solo tiene el servidor.
//
// Con la base sola (por ejemplo, una copia filtrada) no se puede armar un QR
// válido: falta la clave. Con la clave sola tampoco: no se conoce ningún
// número al azar de una entrada real. La puerta revisa la firma ANTES de ir a
// la base, así un QR trucho ni siquiera llega a consultarla.
//
// La clave es propia: CLAVE_CODIGOS (solo en Vercel o en el .env; no es la que
// cifra los tokens de Mercado Pago, así cada una se puede cambiar sin tocar la
// otra). Si se cambia CLAVE_CODIGOS, ningún QR ya emitido sirve más: para
// cambiarla sin eso, la versión 2 leería CLAVE_CODIGOS_V2 y las E1 seguirían
// valiendo mientras tanto.
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION_ACTUAL = "1";
const AL_AZAR = /^[0-9A-F]{32}$/;
const FIRMADO = /^E(\d{1,3})-([0-9A-F]{32})-([0-9A-F]{32})$/;
const LARGO_MAXIMO = 120; // lo que se acepta leer (el código firmado tiene 68)

// La clave de cada versión (null si la versión no existe). Sin la variable, o
// si es corta o la de ejemplo, falla: nunca firma ni acepta con una clave floja.
function claveDe(version: string) {
  if (version !== "1") return null;
  const raiz = process.env.CLAVE_CODIGOS;
  if (!raiz || raiz.length < 32 || raiz.includes("cambiame")) {
    throw new Error("Falta CLAVE_CODIGOS (al menos 32 caracteres al azar)");
  }
  return Buffer.from(hkdfSync("sha256", raiz, "siste-ma", "entradas/codigo/v1", 32));
}

function firma(codigo: string, clave: Buffer) {
  return createHmac("sha256", clave).update(`entrada:${codigo}`).digest().subarray(0, 16);
}

// Un código nuevo, para guardar en la base.
export function nuevoCodigo() {
  return randomBytes(16).toString("hex").toUpperCase();
}

// El texto del QR. Siempre da lo mismo para el mismo código: se puede volver
// a armar el QR (para el PDF o para reenviar las entradas) sin guardarlo.
export function firmarCodigo(codigo: string) {
  if (!AL_AZAR.test(codigo)) throw new Error("Código de entrada con formato desconocido");
  const clave = claveDe(VERSION_ACTUAL)!;
  return `E${VERSION_ACTUAL}-${codigo}-${firma(codigo, clave).toString("hex").toUpperCase()}`;
}

export type CodigoLeido = { ok: true; codigo: string } | { ok: false; motivo: "formato" | "firma" };

// Lo que leyó la cámara (o se pegó a mano) → el código para buscar en la base,
// solo si la firma es correcta. Sin CLAVE_CODIGOS, falla (nunca deja pasar).
export function leerCodigo(texto: unknown): CodigoLeido {
  if (typeof texto !== "string" || texto.length > LARGO_MAXIMO) return { ok: false, motivo: "formato" };
  const partes = FIRMADO.exec(texto.trim().toUpperCase());
  if (!partes) return { ok: false, motivo: "formato" };
  const [, version, codigo, firmaRecibida] = partes;
  const clave = claveDe(version);
  if (!clave) return { ok: false, motivo: "formato" };
  const esperada = firma(codigo, clave);
  const recibida = Buffer.from(firmaRecibida, "hex");
  // Comparación de tiempo constante: no deja adivinar la firma de a pedacitos.
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return { ok: false, motivo: "firma" };
  return { ok: true, codigo };
}
