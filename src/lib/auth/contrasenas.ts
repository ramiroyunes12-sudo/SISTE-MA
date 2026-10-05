// Contraseñas: nunca se guardan tal cual, sino su "hash" con scrypt.
// El hash es una huella que sirve para comprobar una contraseña pero no para
// recuperarla, y scrypt es lento a propósito (~0,4 s) para que probar millones
// de contraseñas sea carísimo. Viene con Node, no hace falta instalar nada.
//
// Formato guardado: scrypt$<log2 N>$<r>$<p>$<sal>$<hash> (sal y hash en base64url).
import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Recomendación de OWASP: N = 2^17, r = 8, p = 1 (usa 128 MB de memoria).
const LOG2_N = 17;
const R = 8;
const P = 1;
const LARGO_HASH = 32;
const LARGO_SAL = 16;
const MEMORIA_MAXIMA = 256 * 1024 * 1024;

// Memoria que necesita scrypt con estos parámetros (la misma cuenta que hace OpenSSL).
function memoriaNecesaria(log2N: number, r: number, p: number) {
  return 128 * r * (2 ** log2N + 2) + 128 * r * p;
}

function derivar(contrasena: string, sal: Buffer, log2N: number, r: number, p: number) {
  const opciones: ScryptOptions = { N: 2 ** log2N, r, p, maxmem: MEMORIA_MAXIMA };
  return new Promise<Buffer>((resolver, rechazar) => {
    scrypt(contrasena.normalize("NFC"), sal, LARGO_HASH, opciones, (error, clave) =>
      error ? rechazar(error) : resolver(clave),
    );
  });
}

export async function hashearContrasena(contrasena: string): Promise<string> {
  const sal = randomBytes(LARGO_SAL);
  const hash = await derivar(contrasena, sal, LOG2_N, R, P);
  return ["scrypt", LOG2_N, R, P, sal.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verificarContrasena(contrasena: string, guardado: string): Promise<boolean> {
  const partes = guardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [log2N, r, p] = partes.slice(1, 4).map(Number);
  // Límites por si el hash guardado está roto: que no cuelgue el servidor.
  if (
    ![log2N, r, p].every(Number.isInteger) ||
    log2N < 10 ||
    log2N > 20 ||
    r < 1 ||
    r > 32 ||
    p < 1 ||
    p > 4 ||
    memoriaNecesaria(log2N, r, p) > MEMORIA_MAXIMA
  ) {
    return false;
  }
  const sal = Buffer.from(partes[4], "base64url");
  const esperado = Buffer.from(partes[5], "base64url");
  if (sal.length < LARGO_SAL || esperado.length !== LARGO_HASH) return false;
  let obtenido: Buffer;
  try {
    obtenido = await derivar(contrasena, sal, log2N, r, p);
  } catch {
    return false; // parámetros que scrypt no acepta: no coincide
  }
  // Comparación en tiempo constante: no da pistas de cuántos caracteres coinciden.
  return timingSafeEqual(obtenido, esperado);
}

// Hash de relleno: sal y huella al azar, así que ninguna contraseña coincide.
// Cuando el email no existe (o la cuenta está bloqueada) se compara igual
// contra este, así la respuesta tarda lo mismo y no delata qué emails existen.
export const HASH_DE_RELLENO = "scrypt$17$8$1$oaH_1c7Jo0ILDhWq1-vwPA$Wk71BHSgj6bO1ayYDIJQ-u__ZtcB13bDcL0g0QCxJnw";

// Contraseña temporal fácil de dictar: 4 grupos de 4 (sin 0/o, 1/l/i).
// 16 caracteres de un alfabeto de 31 = unos 79 bits de azar.
const ALFABETO = "abcdefghjkmnpqrstuvwxyz23456789";
export function generarContrasenaTemporal(): string {
  const grupos = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ALFABETO[randomInt(ALFABETO.length)]).join(""),
  );
  return grupos.join("-");
}
