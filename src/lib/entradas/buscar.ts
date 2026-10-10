// La puerta: buscar entradas por DNI o nombre, para quien llega sin el QR (se
// le murió el celu). Solo mira: marcar el ingreso es marcarEntrada()
// (escanear.ts), con el mismo UPDATE condicionado que el escáner. Y el
// contador de ingresados.
//
// Para no ir listando a la gente del evento (decidido por Ramiro, 10/10/2026):
// el DNI tiene que estar completo y el nombre, desde 3 letras; hasta 10
// resultados. Aparecen solo las entradas que pueden entrar o ya entraron (las
// pagas): ni reservas sin pagar ni anuladas.
import { Prisma, type MetodoIngreso, type PrismaClient } from "@/generated/prisma/client";
import { type Alcance, filtroDeEventos } from "@/lib/auth/alcance";
import { normalizarDni } from "@/lib/ventas/datos";

export const MAXIMO_RESULTADOS = 10;
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
  | { resultado: "falta"; motivo: "dni" | "corto" };

// Sin tildes ni mayúsculas: "Gómez" → "gomez". La base hace lo mismo con
// translate() (ver DESDE y HACIA), así "gomez" encuentra a "Gómez".
function sinTildes(texto: string) {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// Las letras latinas con tilde (mayúsculas y minúsculas) y su letra sin
// tilde, para translate() en la base: no depende de que esté instalada la
// extensión unaccent ni del idioma de la base (con el "C", lower() no pasa
// "Á" a "á"). Los apóstrofos se borran (D’Alessandro → dalessandro).
const [DESDE, HACIA] = (() => {
  let desde = "";
  let hacia = "";
  for (let punto = 0xc0; punto <= 0x24f; punto++) {
    const letra = String.fromCodePoint(punto);
    const base = sinTildes(letra);
    if (/^[a-z]$/.test(base) && base !== letra) {
      desde += letra;
      hacia += base;
    }
  }
  return [desde + "'’", hacia];
})();

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
  if (palabras.join("").length < 3) return { ok: false, motivo: "corto" };
  return { ok: true, busqueda: { palabras } };
}

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
  { eventoId, alcance, texto }: { eventoId: string; alcance: Alcance; texto: unknown },
): Promise<Buscado | null> {
  const evento = await db.evento.findFirst({ where: { id: eventoId, ...filtroDeEventos(alcance) }, select: { id: true } });
  if (!evento) return null;
  const leida = leerBusqueda(texto);
  if (!leida.ok) return { resultado: "falta", motivo: leida.motivo };
  const { busqueda } = leida;

  // Cada palabra en cualquier parte del nombre ("gomez maria" encuentra a
  // "María José Gómez"). Las palabras son solo letras: no traen % ni _.
  const normalizado = Prisma.sql`translate(lower(e.titular), ${DESDE}, ${HACIA})`;
  const condicion =
    "dni" in busqueda
      ? Prisma.sql`e.dni = ${busqueda.dni}`
      : Prisma.join(
          busqueda.palabras.map((palabra) => Prisma.sql`${normalizado} LIKE ${`%${palabra}%`}`),
          " AND ",
        );
  const orden = "dni" in busqueda ? Prisma.sql`o.numero, e.id` : Prisma.sql`${normalizado}, o.numero, e.id`;

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
    ORDER BY ${orden}
    LIMIT ${MAXIMO_RESULTADOS + 1}`;

  return {
    resultado: "ok",
    hayMas: filas.length > MAXIMO_RESULTADOS,
    entradas: filas.slice(0, MAXIMO_RESULTADOS).map((fila) => ({
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

// El contador de la puerta: cuántas entradas ya entraron (usadas) de las que
// pueden entrar (válidas + usadas) en el evento. null si el evento no es de
// quien pregunta.
export async function contarIngresos(
  db: PrismaClient,
  { eventoId, alcance }: { eventoId: string; alcance: Alcance },
): Promise<{ ingresaron: number; total: number } | null> {
  const evento = await db.evento.findFirst({ where: { id: eventoId, ...filtroDeEventos(alcance) }, select: { id: true } });
  if (!evento) return null;
  const grupos = await db.entrada.groupBy({
    by: ["estado"],
    where: { eventoId, estado: { in: ["VALIDA", "USADA"] } },
    _count: { _all: true },
  });
  const cuantas = (estado: "VALIDA" | "USADA") => grupos.find((grupo) => grupo.estado === estado)?._count._all ?? 0;
  return { ingresaron: cuantas("USADA"), total: cuantas("USADA") + cuantas("VALIDA") };
}
