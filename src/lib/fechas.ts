// Fechas en hora de Argentina. La base guarda el instante exacto (UTC); acá
// se pasa de y a lo que ve la persona. Argentina está en UTC−3 todo el año
// (sin horario de verano desde 2009).
export const ZONA_ARGENTINA = "America/Argentina/Buenos_Aires";
const DESFASE = "-03:00";

function partes(fecha: Date) {
  const valores = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA_ARGENTINA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(fecha)
      .map((parte) => [parte.type, parte.value]),
  );
  return valores as Record<"year" | "month" | "day" | "hour" | "minute", string>;
}

// Para el campo <input type="datetime-local">: "2026-11-21T23:00".
export function aFechaLocal(fecha: Date) {
  const p = partes(fecha);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// Lo contrario: "2026-11-21T23:00" (hora argentina) → instante. null si no es válida.
export function deFechaLocal(texto: string): Date | null {
  const coincide = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(texto.trim());
  if (!coincide) return null;
  const fecha = new Date(`${coincide[0]}:00${DESFASE}`);
  // Rechaza fechas que no existen (31/02, 25:00…): al volver tienen que dar lo mismo.
  if (Number.isNaN(fecha.getTime()) || aFechaLocal(fecha) !== coincide[0]) return null;
  return fecha;
}

// Para la página del evento: "Sábado 21 de noviembre · 23:00 hs".
export function formatearFechaLarga(fecha: Date) {
  const texto = new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONA_ARGENTINA,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(fecha); // "sábado, 21 de noviembre"
  const p = partes(fecha);
  const dia = texto.replace(",", "");
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} · ${p.hour}:${p.minute} hs`;
}

// Para mostrar: "sáb 21/11/2026 23:00".
export function formatearFecha(fecha: Date) {
  const dia = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA_ARGENTINA, weekday: "short" })
    .format(fecha)
    .replace(".", "");
  const p = partes(fecha);
  return `${dia} ${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

// Solo la hora: "23:41".
export function formatearHora(fecha: Date) {
  const p = partes(fecha);
  return `${p.hour}:${p.minute}`;
}
