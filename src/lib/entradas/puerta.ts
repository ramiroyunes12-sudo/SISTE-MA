// Lo que ve la puerta después de escanear o buscar: el resultado ya armado en
// texto (la pantalla solo lo muestra). Sin códigos; de la búsqueda, el id de
// cada entrada (para marcar el ingreso).
import type { MetodoIngreso, Rol } from "@/generated/prisma/client";
import { formatearFecha, formatearHora } from "@/lib/fechas";
import { formatearDni } from "@/lib/ventas/datos";

import type { Buscado } from "./buscar";
import type { DatosPuerta, Escaneado, MotivoNoValida } from "./escanear";

export type PersonaPuerta = { titular: string | null; dni: string | null; tipo: string; compra: number };

export type RespuestaPuerta =
  | { resultado: "pasa"; persona: PersonaPuerta }
  | ({ resultado: "ya_ingreso"; persona: PersonaPuerta } & IngresoPuerta)
  | { resultado: "no_valida"; motivo: MotivoNoValida; persona?: PersonaPuerta };

// entro: "a las 23:41, hace 3 minutos" (sin el "hace" pasada la hora; con el
// día, pasadas 12 horas); por: quién la dejó pasar ("vos" = la misma cuenta);
// porDni: la marcaron desde la búsqueda, sin el QR.
export type IngresoPuerta = { entro: string | null; por: string | null; porDni: boolean };

// Errores (sin resultado): la puerta los muestra como NO VÁLIDA, nunca como PASA.
// permiso: un validador quiso marcar el ingreso sin el QR; limite: un
// validador que ya buscó 5 veces en el último minuto.
const ERRORES = ["sesion", "evento", "pedido", "conexion", "permiso", "limite"] as const;
export type ErrorPuerta = { error: (typeof ERRORES)[number] };
const RESULTADOS: string[] = ["pasa", "ya_ingreso", "no_valida"];

const MINUTO = 60 * 1000;
const DOCE_HORAS = 12 * 60 * MINUTO;

// Cuándo entró. En la última hora, también cuánto hace: así un escaneo propio
// que se cortó recién ("hace menos de un minuto") no se confunde con una copia
// del QR que ya entró antes (por ejemplo, por otra puerta con la misma cuenta).
function cuandoEntro(usadaEn: Date, ahora: Date) {
  const hace = Math.max(0, ahora.getTime() - usadaEn.getTime());
  if (hace >= DOCE_HORAS) return `el ${formatearFecha(usadaEn)}`;
  const hora = `a las ${formatearHora(usadaEn)}`;
  const minutos = Math.floor(hace / MINUTO);
  if (minutos >= 60) return hora;
  if (minutos === 0) return `${hora}, hace menos de un minuto`;
  return `${hora}, hace ${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
}

function ingreso(
  usadaEn: Date | null,
  validadaPor: { id: string; nombre: string } | null,
  metodo: MetodoIngreso | null,
  usuarioId: string,
  ahora: Date,
): IngresoPuerta {
  return {
    entro: usadaEn ? cuandoEntro(usadaEn, ahora) : null,
    por: !validadaPor ? null : validadaPor.id === usuarioId ? "vos" : validadaPor.nombre,
    porDni: metodo === "DNI",
  };
}

function persona(datos: DatosPuerta): PersonaPuerta {
  return { titular: datos.titular, dni: datos.dni ? formatearDni(datos.dni) : null, tipo: datos.tipo, compra: datos.compra };
}

export function respuestaPuerta(escaneado: Escaneado, usuarioId: string, ahora = new Date()): RespuestaPuerta {
  switch (escaneado.resultado) {
    case "pasa":
      return { resultado: "pasa", persona: persona(escaneado.entrada) };
    case "ya_ingreso": {
      const { usadaEn, validadaPor, metodo } = escaneado;
      return { resultado: "ya_ingreso", persona: persona(escaneado.entrada), ...ingreso(usadaEn, validadaPor, metodo, usuarioId, ahora) };
    }
    case "no_valida":
      return {
        resultado: "no_valida",
        motivo: escaneado.motivo,
        ...(escaneado.entrada && { persona: persona(escaneado.entrada) }),
      };
  }
}

// En la pantalla de la puerta: lo que contestó el servidor. Solo se cree un
// resultado de una respuesta que salió bien y con un resultado conocido;
// cualquier otra cosa es "falló la conexión" (NO VÁLIDA), nunca PASA.
export function leerRespuestaPuerta(ok: boolean, cuerpo: unknown): RespuestaPuerta | ErrorPuerta {
  if (typeof cuerpo !== "object" || cuerpo === null) return { error: "conexion" };
  if (ok && "resultado" in cuerpo && RESULTADOS.includes(String(cuerpo.resultado))) return cuerpo as RespuestaPuerta;
  if (!ok && "error" in cuerpo) {
    const error = ERRORES.find((conocido) => conocido === cuerpo.error);
    if (error) return { error };
  }
  return { error: "conexion" };
}

// Al seguir escaneando, el QR de recién (todavía delante de la cámara) no se
// vuelve a mandar por un rato, pero solo si el servidor contestó: después de
// un error ("falló la conexión, escaneala de nuevo") la entrada puede seguir
// válida y hay que poder escanearla enseguida.
export function bloqueaRepetir(resultado: RespuestaPuerta | ErrorPuerta) {
  return "resultado" in resultado;
}

// Marcar el ingreso sin el QR (desde la búsqueda): solo el organizador y el
// ADMIN (decidido por Ramiro, 10/10/2026). El validador busca y ve si entró.
export function puedeMarcarSinQr(rol: Rol) {
  return rol === "ADMIN" || rol === "ORGANIZADOR";
}

// ─── Buscar por DNI o nombre ─────────────────────────────────────────────────

export type EncontradaPuerta = { id: string; persona: PersonaPuerta; ingreso: IngresoPuerta | null };
export type RespuestaBusqueda = { encontradas: EncontradaPuerta[]; hayMas: boolean } | { falta: "dni" | "corto" };
const FALTAS: string[] = ["dni", "corto"];

export function respuestaBusqueda(
  buscado: Exclude<Buscado, { resultado: "limite" }>,
  usuarioId: string,
  ahora = new Date(),
): RespuestaBusqueda {
  if (buscado.resultado === "falta") return { falta: buscado.motivo };
  return {
    hayMas: buscado.hayMas,
    encontradas: buscado.entradas.map((entrada) => ({
      id: entrada.id,
      persona: persona(entrada),
      ingreso: entrada.ingreso
        ? ingreso(entrada.ingreso.usadaEn, entrada.ingreso.validadaPor, entrada.ingreso.metodo, usuarioId, ahora)
        : null,
    })),
  };
}

// En la pantalla: lo que contestó el servidor a la búsqueda (como
// leerRespuestaPuerta: cualquier cosa rara es "falló la conexión").
export function leerRespuestaBusqueda(ok: boolean, cuerpo: unknown): RespuestaBusqueda | ErrorPuerta {
  if (typeof cuerpo !== "object" || cuerpo === null) return { error: "conexion" };
  if (ok && "encontradas" in cuerpo && Array.isArray(cuerpo.encontradas)) return cuerpo as RespuestaBusqueda;
  if (ok && "falta" in cuerpo && FALTAS.includes(String(cuerpo.falta))) return cuerpo as RespuestaBusqueda;
  if (!ok) return leerRespuestaPuerta(ok, cuerpo) as ErrorPuerta;
  return { error: "conexion" };
}

// ─── El contador ─────────────────────────────────────────────────────────────

export type Contador = { ingresaron: number; total: number };

// null si la respuesta no es un contador que cierre (la pantalla deja el último).
export function leerContador(ok: boolean, cuerpo: unknown): Contador | null {
  if (!ok || typeof cuerpo !== "object" || cuerpo === null) return null;
  const { ingresaron, total } = cuerpo as Record<string, unknown>;
  if (!Number.isInteger(ingresaron) || !Number.isInteger(total)) return null;
  const [entraron, de] = [ingresaron as number, total as number];
  if (entraron < 0 || entraron > de) return null;
  return { ingresaron: entraron, total: de };
}
