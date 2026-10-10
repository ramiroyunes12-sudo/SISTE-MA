// La puerta: buscar entradas por DNI o nombre, para quien llega sin el QR (se
// le murió el celu). Solo mira: marcar el ingreso es marcarEntrada()
// (escanear.ts), con el mismo UPDATE condicionado que el escáner. Y el
// contador de ingresados.
//
// Para no ir listando a la gente del evento (decidido por Ramiro, 10/10/2026):
// el DNI tiene que estar completo y el nombre, desde 3 letras; hasta 10
// resultados; un validador, hasta 5 búsquedas por minuto; y cada búsqueda
// queda anotada en `busquedas` (quién, qué y cuándo). Aparecen solo las
// entradas que pueden entrar o ya entraron (las pagas): ni reservas sin pagar
// ni anuladas.
import { Prisma, type MetodoIngreso, type PrismaClient, type Rol } from "@/generated/prisma/client";
import { type Alcance, filtroDeEventos } from "@/lib/auth/alcance";
import { normalizarDni } from "@/lib/ventas/datos";

export const MAXIMO_RESULTADOS = 10;
export const BUSQUEDAS_POR_MINUTO = 5; // de cada validador
const MINUTO = 60 * 1000;
const MAXIMO_PALABRAS = 6;

export type Busqueda = { dni: string } | { palabras: string[] };

export type Encontrada = {
  id: string;
  titular: string | null;
  dni: string | null;
  tipo: string;
  compra: number;
  // null si todavía no entró
  ingreso: { usadaEn: Date | null; validadaPor: { id: string; nombre: string } | null; metodo: MetodoIngreso | null } | null;
};

export type Buscado =
  | { resultado: "ok"; entradas: Encontrada[]; hayMas: boolean }
  // dni: hay números pero no es un DNI completo; corto: menos de 3 letras
  | { resultado: "falta"; motivo: "dni" | "corto" }
  // un validador que ya buscó 5 veces en el último minuto
  | { resultado: "limite" };

// Sin tildes ni mayúsculas: "Gómez" → "gomez".
function sinTildes(texto: string) {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// Para cada letra sin tilde, todas las letras latinas que dan esa (con tilde y
// en mayúscula): "o" → "oòóôõöōŏő…OÒÓ…". Con esto cada palabra buscada se
// vuelve una expresión regular ("gomez" → "[gĝğ…G…][oò…O…]…") que la base
// compara con el nombre tal como está guardado: no hace falta pasar cada
// nombre a minúsculas y sin tildes (con miles de entradas era medio segundo
// por búsqueda), no depende de la extensión unaccent ni del idioma de la base,
// y entran las letras que acepta el checkout aunque no sean del castellano
// (ỹ del guaraní, ễ del vietnamita).
const VARIANTES = (() => {
  const variantes = new Map<string, string>();
  const rangos = [
    [0x41, 0x5a],
    [0x61, 0x7a],
    [0xc0, 0x24f],
    [0x1e00, 0x1eff],
  ];
  for (const [desde, hasta] of rangos) {
    for (let punto = desde; punto <= hasta; punto++) {
      const letra = String.fromCodePoint(punto);
      const base = sinTildes(letra);
      if (!/^\p{L}$/u.test(letra) || [...base].length !== 1) continue;
      variantes.set(base, (variantes.get(base) ?? "") + letra);
    }
  }
  return variantes;
})();

// Las palabras son solo letras: no traen nada que la expresión regular lea
// distinto (ni "]", "^", "-" ni "\\").
function patron(palabra: string) {
  return [...palabra].map((letra) => `[${VARIANTES.get(letra) ?? letra}]`).join("");
}

// Qué buscar: un DNI completo (con o sin puntos) o palabras del nombre.
export function leerBusqueda(texto: unknown): { ok: true; busqueda: Busqueda } | { ok: false; motivo: "dni" | "corto" } {
  if (typeof texto !== "string") return { ok: false, motivo: "corto" };
  if (/\d/.test(texto)) {
    const dni = normalizarDni(texto.trim());
    if (!/^\d{6,8}$/.test(dni) || /^0+$/.test(dni)) return { ok: false, motivo: "dni" };
    return { ok: true, busqueda: { dni } };
  }
  const palabras = sinTildes(texto)
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .slice(0, MAXIMO_PALABRAS);
  // Al menos una palabra de 3 letras: "a a a" sería buscar a todos los que
  // tienen una "a".
  if (!palabras.some((palabra) => [...palabra].length >= 3)) return { ok: false, motivo: "corto" };
  return { ok: true, busqueda: { palabras } };
}

// El DNI con y sin ceros adelante ("1234567" y "01234567"): el checkout los
// guarda como se escribieron. Con = ANY(...) se sigue usando el índice.
function variantesDni(dni: string) {
  const sinCeros = dni.replace(/^0+/, "");
  const variantes: string[] = [];
  for (let largo = Math.max(6, sinCeros.length); largo <= 8; largo++) variantes.push(sinCeros.padStart(largo, "0"));
  return variantes;
}

const ORDEN_NOMBRES = new Intl.Collator("es", { sensitivity: "base" });

type Fila = {
  id: string;
  titular: string | null;
  dni: string | null;
  tipo: string;
  compra: number;
  estado: "VALIDA" | "USADA";
  usada_en: Date | null;
  validada_por_id: string | null;
  validada_por_nombre: string | null;
  metodo: MetodoIngreso | null;
};

// null si el evento no existe o no es de quien busca (su productora; el
// ADMIN, todos).
export async function buscarEnLaPuerta(
  db: PrismaClient,
  {
    eventoId,
    alcance,
    usuario,
    texto,
    ahora = new Date(),
  }: { eventoId: string; alcance: Alcance; usuario: { id: string; rol: Rol }; texto: unknown; ahora?: Date },
): Promise<Buscado | null> {
  const evento = await db.evento.findFirst({ where: { id: eventoId, ...filtroDeEventos(alcance) }, select: { id: true } });
  if (!evento) return null;
  const leida = leerBusqueda(texto);
  if (!leida.ok) return { resultado: "falta", motivo: leida.motivo };
  const { busqueda } = leida;
  if (!(await anotarBusqueda(db, { eventoId, usuario, texto: String(texto).trim(), ahora }))) return { resultado: "limite" };

  // Cada palabra en cualquier parte del nombre ("gomez maria" encuentra a
  // "María José Gómez"), sin mirar los apóstrofos (D’Alessandro).
  const condicion =
    "dni" in busqueda
      ? Prisma.sql`e.dni = ANY(${variantesDni(busqueda.dni)})`
      : Prisma.join(
          busqueda.palabras.map((palabra) => Prisma.sql`translate(e.titular, ${"'’"}, '') ~ ${patron(palabra)}`),
          " AND ",
        );

  const filas = await db.$queryRaw<Fila[]>`
    SELECT e.id, e.titular, e.dni, t.nombre AS tipo, o.numero AS compra, e.estado::text AS estado,
      e.usada_en, u.id AS validada_por_id, u.nombre AS validada_por_nombre, pasa.metodo
    FROM entradas.entradas AS e
    JOIN entradas.ordenes AS o ON o.id = e.orden_id
    JOIN entradas.tipos_entrada AS t ON t.id = e.tipo_entrada_id
    LEFT JOIN entradas.usuarios AS u ON u.id = e.validada_por_id
    LEFT JOIN LATERAL (
      SELECT s.metodo FROM entradas.escaneos AS s
      WHERE s.entrada_id = e.id AND s.resultado = 'PASA'
      ORDER BY s.creado_en DESC LIMIT 1
    ) AS pasa ON e.estado = 'USADA'
    WHERE e.evento_id = ${eventoId}::uuid
      AND (e.estado = 'USADA' OR (e.estado = 'VALIDA' AND o.estado = 'PAGADA'))
      AND ${condicion}
    ORDER BY o.numero, e.id
    LIMIT ${MAXIMO_RESULTADOS + 1}`;

  // Por nombre, en orden alfabético (si hay más de 10, igual hay que escribir más).
  const mostradas = filas.slice(0, MAXIMO_RESULTADOS);
  if ("palabras" in busqueda) mostradas.sort((una, otra) => ORDEN_NOMBRES.compare(una.titular ?? "", otra.titular ?? ""));

  return {
    resultado: "ok",
    hayMas: filas.length > MAXIMO_RESULTADOS,
    entradas: mostradas.map((fila) => ({
      id: fila.id,
      titular: fila.titular,
      dni: fila.dni,
      tipo: fila.tipo,
      compra: fila.compra,
      ingreso:
        fila.estado === "USADA"
          ? {
              usadaEn: fila.usada_en,
              validadaPor: fila.validada_por_id ? { id: fila.validada_por_id, nombre: fila.validada_por_nombre ?? "" } : null,
              metodo: fila.metodo,
            }
          : null,
    })),
  };
}

// Anota la búsqueda (quién, qué y cuándo) antes de hacerla. Un validador que
// ya buscó 5 veces en el último minuto no puede: false. De a una búsqueda por
// cuenta (con el turno de la base), así 10 a la vez no pasan todas el tope.
async function anotarBusqueda(
  db: PrismaClient,
  { eventoId, usuario, texto, ahora }: { eventoId: string; usuario: { id: string; rol: Rol }; texto: string; ahora: Date },
) {
  return db.$transaction(async (tx) => {
    if (usuario.rol === "VALIDADOR") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`busquedas:${usuario.id}`}, 0))`;
      const recientes = await tx.busqueda.count({
        where: { usuarioId: usuario.id, creadoEn: { gt: new Date(ahora.getTime() - MINUTO) } },
      });
      if (recientes >= BUSQUEDAS_POR_MINUTO) return false;
    }
    await tx.busqueda.create({ data: { eventoId, usuarioId: usuario.id, texto, creadoEn: ahora } });
    return true;
  });
}

// El contador de la puerta: cuántas entradas ya entraron (usadas) de las que
// pueden entrar (válidas con la compra paga + usadas) en el evento. null si el
// evento no es de quien pregunta.
export async function contarIngresos(
  db: PrismaClient,
  { eventoId, alcance }: { eventoId: string; alcance: Alcance },
): Promise<{ ingresaron: number; total: number } | null> {
  const evento = await db.evento.findFirst({ where: { id: eventoId, ...filtroDeEventos(alcance) }, select: { id: true } });
  if (!evento) return null;
  const grupos = await db.entrada.groupBy({
    by: ["estado"],
    where: { eventoId, OR: [{ estado: "USADA" }, { estado: "VALIDA", orden: { estado: "PAGADA" } }] },
    _count: { _all: true },
  });
  const cuantas = (estado: "VALIDA" | "USADA") => grupos.find((grupo) => grupo.estado === estado)?._count._all ?? 0;
  return { ingresaron: cuantas("USADA"), total: cuantas("USADA") + cuantas("VALIDA") };
}
