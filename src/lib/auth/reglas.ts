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
]);

// Filas del teclado y secuencias: "qwertyuiop", "1q2w3e4r5t", "abcdefghij"…
const SECUENCIAS = [
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiopasdfghjklnzxcvbnm",
  "qwertyuiop",
  "asdfghjkln",
  "zxcvbnm",
  "1q2w3e4r5t6y7u8i9o0p",
  "qazwsxedcrfvtgbyhnujmikolp",
  "01234567890",
];

function sinTildes(texto: string) {
  return texto.normalize("NFD").replace(/\p{M}/gu, "");
}

function esSecuencia(texto: string) {
  return (
    texto.length > 0 &&
    SECUENCIAS.some(
      (secuencia) => secuencia.includes(texto) || [...secuencia].reverse().join("").includes(texto),
    )
  );
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
  if (letras === "") return "usá también letras: solo números es muy fácil de adivinar.";
  if (new Set(nueva).size < 4 || esRepeticion(letras) || esRepeticion(letrasYNumeros)) {
    return "es muy fácil de adivinar: usá más caracteres distintos.";
  }
  if (PALABRAS_COMUNES.has(letras)) return "es de las contraseñas más usadas; elegí otra.";
  if (
    esSecuencia(letrasYNumeros) ||
    (letras.length >= 4 && esSecuencia(letras)) ||
    (letras.length < 4 && esSecuencia(numeros))
  ) {
    return "es una secuencia del teclado o de números; elegí otra.";
  }
  return null;
}
