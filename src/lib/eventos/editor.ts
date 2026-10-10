// Lo que manda la pantalla "Evento y lotes" y su validación. Sin nada del
// servidor: la misma forma de los datos la usa el formulario en el navegador.
import { parsearPesos } from "@/lib/dinero";
import { deFechaLocal } from "@/lib/fechas";

export const ESTADOS_EVENTO = ["BORRADOR", "PUBLICADO", "FINALIZADO"] as const;
export type EstadoEvento = (typeof ESTADOS_EVENTO)[number];

export const MAX_TIPOS = 10;
// Entradas por compra: como mucho 4 en cualquier evento (decidido por Ramiro,
// 10/10/2026). Cada evento puede poner menos.
export const MAX_POR_COMPRA = 4;
export const MAX_LOTES = 10;
const MAX_CUPO = 100_000;
const MAX_PRECIO = 100_000_000; // centavos: un millón de pesos

// Tal cual vienen del formulario (todo texto, como lo escribió la persona).
export type LoteEditado = { id?: string; nombre: string; precio: string; cupo: string };
export type TipoEditado = { id?: string; nombre: string; lotes: LoteEditado[] };
export type EventoEditado = {
  productoraId?: string; // solo al crear, y solo lo elige el ADMIN
  nombre: string;
  slug: string;
  fecha: string; // "2026-11-21T23:00", hora argentina
  lugar: string;
  direccion: string;
  descripcion: string;
  maxPorCompra: string;
  cupoCortesias: string;
  estado: EstadoEvento;
  tipos: TipoEditado[];
};

// Ya revisado y convertido, listo para guardar.
export type LoteValidado = { id?: string; nombre: string; precioCentavos: number; cupo: number };
export type TipoValidado = { id?: string; nombre: string; orden: number; lotes: LoteValidado[] };
export type EventoValidado = {
  productoraId: string | null; // la que eligió el ADMIN al crear (los demás: la suya)
  nombre: string;
  slug: string;
  slugAutomatico: boolean; // la persona no eligió dirección: se arma con el nombre
  fecha: Date;
  lugar: string;
  direccion: string | null;
  descripcion: string | null;
  maxPorCompra: number;
  cupoCortesias: number;
  estado: EstadoEvento;
  tipos: TipoValidado[];
};

// Errores por campo: "nombre", "tipos.0.nombre", "tipos.0.lotes.1.precio"… y "general".
export type Errores = Record<string, string>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// "Fiesta de Primavera 2026!" → "fiesta-de-primavera-2026"
export function slugDesde(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

function entero(valor: unknown, minimo: number, maximo: number): number | null {
  const limpio = texto(valor);
  if (!/^\d+$/.test(limpio)) return null;
  const numero = Number(limpio);
  return numero >= minimo && numero <= maximo ? numero : null;
}

function idOpcional(valor: unknown): string | undefined | false {
  if (valor === undefined || valor === null || valor === "") return undefined;
  return typeof valor === "string" && UUID.test(valor) ? valor : false;
}

function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
}

export function validarEvento(
  entrada: unknown,
): { ok: true; datos: EventoValidado } | { ok: false; errores: Errores } {
  const e = objeto(entrada);
  const errores: Errores = {};

  const nombre = texto(e.nombre);
  if (nombre.length < 3 || nombre.length > 120) errores.nombre = "Poné un nombre de 3 a 120 caracteres.";

  const slugEscrito = texto(e.slug).toLowerCase();
  const slug = slugEscrito || slugDesde(nombre);
  if (slugEscrito && (!SLUG.test(slugEscrito) || slugEscrito.length < 3 || slugEscrito.length > 60)) {
    errores.slug = "Solo letras minúsculas sin tilde, números y guiones (de 3 a 60). Ej.: fiesta-primavera";
  } else if (!slugEscrito && slug.length < 3) {
    errores.slug = "Escribí la dirección de la página (ej.: fiesta-primavera).";
  }

  const fecha = deFechaLocal(texto(e.fecha));
  if (!fecha) errores.fecha = "Elegí el día y la hora.";

  const lugar = texto(e.lugar);
  if (lugar.length < 2 || lugar.length > 120) errores.lugar = "Poné el lugar (de 2 a 120 caracteres).";
  const direccion = texto(e.direccion);
  if (direccion.length > 200) errores.direccion = "Hasta 200 caracteres.";
  const descripcion = texto(e.descripcion);
  if (descripcion.length > 5000) errores.descripcion = "Hasta 5000 caracteres.";

  const maxPorCompra = entero(e.maxPorCompra, 1, MAX_POR_COMPRA);
  if (maxPorCompra === null) errores.maxPorCompra = `Un número de 1 a ${MAX_POR_COMPRA}.`;
  const cupoCortesias = entero(e.cupoCortesias, 0, MAX_CUPO);
  if (cupoCortesias === null) errores.cupoCortesias = `Un número de 0 a ${MAX_CUPO}.`;

  const productoraId = idOpcional(e.productoraId);
  if (productoraId === false) errores.productoraId = "Elegí una productora.";

  const estado = ESTADOS_EVENTO.find((opcion) => opcion === e.estado);
  if (!estado) errores.estado = "Elegí un estado.";

  const tiposEntrada = lista(e.tipos);
  if (tiposEntrada.length > MAX_TIPOS) errores.general = `Como mucho ${MAX_TIPOS} tipos de entrada.`;

  const nombresDeTipos = new Set<string>();
  let totalLotes = 0;
  const tipos: TipoValidado[] = tiposEntrada.slice(0, MAX_TIPOS).map((valorTipo, t) => {
    const tipo = objeto(valorTipo);
    const clave = `tipos.${t}`;
    const id = idOpcional(tipo.id);
    if (id === false) errores.general = "Los datos no son válidos. Recargá la página.";

    const nombreTipo = texto(tipo.nombre);
    if (nombreTipo.length < 1 || nombreTipo.length > 60) {
      errores[`${clave}.nombre`] = "Poné un nombre (ej.: General, VIP).";
    } else if (nombresDeTipos.has(nombreTipo.toLowerCase())) {
      errores[`${clave}.nombre`] = "Ya hay otro tipo con este nombre.";
    }
    nombresDeTipos.add(nombreTipo.toLowerCase());

    const lotesEntrada = lista(tipo.lotes);
    if (lotesEntrada.length > MAX_LOTES) errores[`${clave}.nombre`] = `Como mucho ${MAX_LOTES} lotes por tipo.`;
    const lotes: LoteValidado[] = lotesEntrada.slice(0, MAX_LOTES).map((valorLote, l) => {
      const lote = objeto(valorLote);
      const claveLote = `${clave}.lotes.${l}`;
      const idLote = idOpcional(lote.id);
      if (idLote === false) errores.general = "Los datos no son válidos. Recargá la página.";

      const nombreLote = texto(lote.nombre);
      if (nombreLote.length < 1 || nombreLote.length > 60) errores[`${claveLote}.nombre`] = "Poné un nombre.";
      const precioCentavos = parsearPesos(texto(lote.precio));
      if (!texto(lote.precio)) errores[`${claveLote}.precio`] = "Poné el precio.";
      else if (precioCentavos === 0) {
        errores[`${claveLote}.precio`] = "Tiene que ser más de $ 0 (para regalar, usá las cortesías).";
      } else if (precioCentavos === null || precioCentavos > MAX_PRECIO) {
        errores[`${claveLote}.precio`] = "No se entiende el precio. Escribilo así: 8000 o 8.000";
      }
      const cupo = entero(lote.cupo, 0, MAX_CUPO);
      if (!texto(lote.cupo)) errores[`${claveLote}.cupo`] = "Poné el cupo.";
      else if (cupo === null) errores[`${claveLote}.cupo`] = `Un número de 0 a ${MAX_CUPO}.`;
      return { id: idLote || undefined, nombre: nombreLote, precioCentavos: precioCentavos ?? 0, cupo: cupo ?? 0 };
    });
    totalLotes += lotes.length;
    return { id: id || undefined, nombre: nombreTipo, orden: t, lotes };
  });

  if (estado === "PUBLICADO" && totalLotes === 0) {
    errores.estado = "Para publicarlo, agregá al menos un tipo de entrada con un lote.";
  }

  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return {
    ok: true,
    datos: {
      productoraId: productoraId || null,
      nombre,
      slug,
      slugAutomatico: !slugEscrito,
      fecha: fecha!,
      lugar,
      direccion: direccion || null,
      descripcion: descripcion || null,
      maxPorCompra: maxPorCompra!,
      cupoCortesias: cupoCortesias!,
      estado: estado!,
      tipos,
    },
  };
}
