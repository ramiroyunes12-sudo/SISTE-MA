// Reglas para las contraseñas nuevas. Sin nada del servidor: también las usa
// el formulario en el navegador para avisar antes de mandar.
export const LARGO_MINIMO = 10;
export const LARGO_MAXIMO = 128;

// Palabras que los que prueban contraseñas intentan primero. Se comparan solo
// las letras (sin tildes, números ni símbolos): "Argentina2026!" cuenta como
// "argentina".
const PALABRAS_COMUNES = new Set([
  "password", "passwd", "contrasena", "contrasenia", "micontrasena", "clave", "miclave", "claveclave",
  "secreto", "admin", "administrador", "administrator", "root", "usuario", "user", "login",
  "qwerty", "asdf", "abc", "abcd", "iloveyou", "teamo", "tequiero", "amor", "hola", "holamundo",
  "bienvenido", "welcome", "letmein", "master", "dragon", "monkey", "sunshine", "princess",
  "superman", "batman", "pokemon", "football", "futbol", "messi", "maradona", "boca",
  "bocajuniors", "river", "riverplate", "racing", "independiente", "sanlorenzo", "argentina",
  "corrientes", "buenosaires", "cordoba", "rosario", "google", "gmail", "hotmail", "facebook",
  "instagram", "whatsapp", "entrada", "entradas", "boliche", "fiesta", "evento", "eventos",
  "puerta", "validador", "panel", "sistema", "ticket", "tickets", "passline", "mate",
  "changeme", "trustno",
]);

// Los reemplazos de siempre: "P@ssw0rd" es "password", "4rg3ntina" es "argentina".
const REEMPLAZOS: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i",
};

// Filas del teclado y secuencias: "qwertyuiop", "1q2w3e4r5t", "abcdefghij"…
// Cada fila por separado (pegadas formarían palabras como "sapo").
const SECUENCIAS = [
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiop",
  "asdfghjkln",
  "zxcvbnm",
  "1q2w3e4r5t6y7u8i9o0p",
  "01234567890",
];
// Columnas del teclado ("qazwsx…"): solo cuentan tramos largos.
const COLUMNAS = "qazwsxedcrfvtgbyhnujmikolp";

function sinTildes(texto: string) {
  return texto.normalize("NFD").replace(/\p{M}/gu, "");
}

function contieneEnAlgunSentido(secuencia: string, texto: string) {
  return secuencia.includes(texto) || [...secuencia].reverse().join("").includes(texto);
}

function esSecuencia(texto: string) {
  if (texto.length === 0) return false;
  return (
    SECUENCIAS.some((secuencia) => contieneEnAlgunSentido(secuencia, texto)) ||
    (texto.length >= 6 && contieneEnAlgunSentido(COLUMNAS, texto))
  );
}

// ¿Es una palabra común con reemplazos ("P@ssw0rd") y solo números o
// símbolos al final ("P@ssw0rd123", "C0ntr4s3n4!")?
function esComunDisfrazada(simple: string) {
  const caracteres = [...simple];
  const deshecha = caracteres.map((c) => REEMPLAZOS[c] ?? c).join("");
  for (const palabra of PALABRAS_COMUNES) {
    if (palabra.length < 4 || !deshecha.startsWith(palabra)) continue;
    const resto = caracteres.slice(palabra.length).join("");
    if (!/[a-z]/.test(resto)) return true;
  }
  return PALABRAS_COMUNES.has(deshecha.replace(/[^a-z]/g, ""));
}

// "abababab", "ab12ab12ab12": un pedacito de hasta 4 caracteres repetido.
function esRepeticion(texto: string) {
  return texto.length >= 6 && /^(.{1,4})\1+$/.test(texto);
}

// Devuelve el problema, o null si la contraseña está bien.
export function problemaConContrasenaNueva(nueva: string, email: string): string | null {
  if (nueva.length < LARGO_MINIMO) return `tiene que tener al menos ${LARGO_MINIMO} caracteres.`;
  if (nueva.length > LARGO_MAXIMO) return `puede tener hasta ${LARGO_MAXIMO} caracteres.`;
  if (nueva.trim() !== nueva) return "no puede empezar ni terminar con espacios.";

  const simple = sinTildes(nueva.toLowerCase());
  const letras = simple.replace(/[^a-z]/g, "");
  const numeros = simple.replace(/[^0-9]/g, "");
  const letrasYNumeros = simple.replace(/[^a-z0-9]/g, "");
  const usuarioDelEmail = sinTildes(email.toLowerCase().split("@")[0]).replace(/[^a-z0-9]/g, "");

  if (simple === email.toLowerCase()) return "no puede ser igual a tu email.";
  if (usuarioDelEmail.length >= 4 && letrasYNumeros.includes(usuarioDelEmail)) {
    return "no puede contener tu email.";
  }
  // (Si no hay letras de nuestro abecedario pero sí de otro, se sigue con las demás reglas.)
  if (letras === "" && !/\p{L}/u.test(nueva)) {
    return "usá también letras: solo números y símbolos es muy fácil de adivinar.";
  }
  if (new Set(nueva).size < 4 || esRepeticion(letras) || esRepeticion(letrasYNumeros)) {
    return "es muy fácil de adivinar: usá más caracteres distintos.";
  }
  if (PALABRAS_COMUNES.has(letras) || esComunDisfrazada(simple)) {
    return "es de las contraseñas más usadas; elegí otra.";
  }
  if (
    esSecuencia(letrasYNumeros) ||
    (letras.length >= 4 && esSecuencia(letras)) ||
    (letras.length < 4 && numeros.length >= 4 && esSecuencia(numeros))
  ) {
    return "es una secuencia del teclado o de números; elegí otra.";
  }
  return null;
}
