// Los datos del checkout: a dónde mandar las entradas (email y celular) y
// nombre y DNI de cada persona que va a entrar ("Entrada 1", "Entrada 2"…).
// Se revisan en el navegador (para avisar enseguida) y de nuevo en el
// servidor. Un mismo DNI puede tener varias entradas.
//
// Los campos del formulario se llaman nombre-0, dni-0, nombre-1… y email,
// email2, telefono; los errores usan esas mismas claves.

export type DatosEntrada = { nombre: string; dni: string };
export type DatosCompra = { email: string; telefono: string | null; entradas: DatosEntrada[] };
export type ErroresDatos = Record<string, string>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letras (con tildes y ñ), espacios, apóstrofo, guion y punto.
// Solo letras latinas (con acentos), como en el DNI: las demás no se pueden
// imprimir en la entrada.
const NOMBRE = /^[\p{Script=Latin}][\p{Script=Latin}'’.\- ]*$/u;

// "  juan   pérez " → "juan pérez"
export function normalizarNombre(texto: string) {
  return texto.trim().replace(/\s+/g, " ");
}

// "40.123.456" → "40123456"
export function normalizarDni(texto: string) {
  return texto.replace(/[\s.\-]/g, "");
}

// "+54 9 (379) 412-3456" → "+5493794123456"
export function normalizarTelefono(texto: string) {
  return texto.trim().replace(/[\s().\-]/g, "");
}

export function errorDeNombre(texto: string): string | undefined {
  const nombre = normalizarNombre(texto);
  if (!nombre) return "Poné nombre y apellido.";
  if (nombre.length > 80) return "Es muy largo (hasta 80 letras).";
  if (!NOMBRE.test(nombre)) return "Solo letras, como figura en el DNI.";
  if (nombre.split(" ").length < 2) return "Poné nombre y apellido.";
  return undefined;
}

export function errorDeDni(texto: string): string | undefined {
  const dni = normalizarDni(texto);
  if (!dni) return "Poné el DNI.";
  if (!/^\d{6,8}$/.test(dni) || /^0+$/.test(dni)) return "El DNI son 7 u 8 números (con o sin puntos).";
  return undefined;
}

export function errorDeEmail(texto: string): string | undefined {
  const email = texto.trim().toLowerCase();
  if (!email) return "Poné tu email.";
  if (!EMAIL.test(email) || email.length > 200) return "Ese email no parece válido. Revisalo.";
  return undefined;
}

export function errorDeTelefono(texto: string): string | undefined {
  const telefono = normalizarTelefono(texto);
  if (!telefono) return undefined; // es opcional
  if (!/^\+?\d{8,15}$/.test(telefono)) return "Poné un celular válido, por ejemplo 379 412 3456.";
  return undefined;
}

// Lo que se escribió, campo por campo (de un FormData o de un objeto).
type Leer = (campo: string) => unknown;

export function validarDatosCompra(
  leer: Leer,
  cantidad: number,
): { ok: true; datos: DatosCompra } | { ok: false; errores: ErroresDatos } {
  const texto = (campo: string) => {
    const valor = leer(campo);
    return typeof valor === "string" ? valor : "";
  };
  const errores: ErroresDatos = {};
  const entradas: DatosEntrada[] = [];
  for (let i = 0; i < cantidad; i++) {
    const nombre = texto(`nombre-${i}`);
    const dni = texto(`dni-${i}`);
    const errorNombre = errorDeNombre(nombre);
    const errorDni = errorDeDni(dni);
    if (errorNombre) errores[`nombre-${i}`] = errorNombre;
    if (errorDni) errores[`dni-${i}`] = errorDni;
    entradas.push({ nombre: normalizarNombre(nombre), dni: normalizarDni(dni) });
  }

  const email = texto("email").trim().toLowerCase();
  const errorEmail = errorDeEmail(email);
  if (errorEmail) errores.email = errorEmail;
  else if (texto("email2").trim().toLowerCase() !== email) errores.email2 = "Los dos emails no coinciden.";

  const errorTelefono = errorDeTelefono(texto("telefono"));
  if (errorTelefono) errores.telefono = errorTelefono;

  if (Object.keys(errores).length) return { ok: false, errores };
  return { ok: true, datos: { email, telefono: normalizarTelefono(texto("telefono")) || null, entradas } };
}

// "40123456" → "40.123.456" (para mostrar).
export function formatearDni(dni: string) {
  return dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
