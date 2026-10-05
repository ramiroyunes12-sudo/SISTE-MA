// Reglas para las contraseñas nuevas. Sin nada del servidor: también las usa
// el formulario en el navegador.
export const LARGO_MINIMO = 10;
export const LARGO_MAXIMO = 128;

// Devuelve el problema, o null si la contraseña está bien.
export function problemaConContrasenaNueva(nueva: string, email: string): string | null {
  if (nueva.length < LARGO_MINIMO) return `tiene que tener al menos ${LARGO_MINIMO} caracteres.`;
  if (nueva.length > LARGO_MAXIMO) return `puede tener hasta ${LARGO_MAXIMO} caracteres.`;
  if (nueva.trim() !== nueva) return "no puede empezar ni terminar con espacios.";
  if (nueva.toLowerCase() === email.toLowerCase()) return "no puede ser igual a tu email.";
  if (new Set(nueva).size < 4) return "es muy fácil de adivinar: usá más caracteres distintos.";
  return null;
}
