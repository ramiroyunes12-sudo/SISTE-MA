// Cifrar datos secretos que se guardan en la base (por ahora, el Access Token
// de Mercado Pago de cada productora). Así una copia de la base sola no
// alcanza para usarlos: la clave está en la variable CLAVE_CIFRADO (solo en
// Vercel o en el .env).
//
// AES-256-GCM: si alguien toca el texto cifrado, descifrar falla. El
// "contexto" (por ejemplo, el id de la productora) va pegado al cifrado: un
// token copiado a otra productora no se puede descifrar.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";

// Al menos 32 caracteres, y no la de ejemplo de .env.example.
function claveValida(texto: string | undefined): texto is string {
  return Boolean(texto && texto.length >= 32 && !texto.includes("cambiame"));
}

function clave() {
  const texto = process.env.CLAVE_CIFRADO;
  if (!claveValida(texto)) throw new Error("Falta CLAVE_CIFRADO (al menos 32 caracteres al azar)");
  return createHash("sha256").update(texto).digest();
}

export function hayClaveDeCifrado() {
  return claveValida(process.env.CLAVE_CIFRADO);
}

// Otra clave sacada de CLAVE_CIFRADO, para otro uso (por ejemplo, firmar los
// códigos de las entradas). Con HKDF y una etiqueta distinta por uso: saber
// una de estas claves no sirve para calcular las otras ni la de cifrado.
export function claveDerivada(etiqueta: string) {
  const texto = process.env.CLAVE_CIFRADO;
  if (!claveValida(texto)) throw new Error("Falta CLAVE_CIFRADO (al menos 32 caracteres al azar)");
  return Buffer.from(hkdfSync("sha256", texto, "siste-ma", etiqueta, 32));
}

export function cifrar(texto: string, contexto: string) {
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", clave(), iv);
  cifrador.setAAD(Buffer.from(contexto, "utf8"));
  const datos = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  return [VERSION, iv.toString("base64url"), datos.toString("base64url"), cifrador.getAuthTag().toString("base64url")].join(".");
}

export function descifrar(guardado: string, contexto: string) {
  const [version, iv, datos, sello] = guardado.split(".");
  if (version !== VERSION || !iv || !datos || !sello) throw new Error("Dato cifrado con formato desconocido");
  const descifrador = createDecipheriv("aes-256-gcm", clave(), Buffer.from(iv, "base64url"), { authTagLength: 16 });
  descifrador.setAAD(Buffer.from(contexto, "utf8"));
  descifrador.setAuthTag(Buffer.from(sello, "base64url"));
  return Buffer.concat([descifrador.update(Buffer.from(datos, "base64url")), descifrador.final()]).toString("utf8");
}
