// Lo que ve la puerta después de escanear: el resultado ya armado en texto
// (la pantalla del escáner solo lo muestra). Sin ids ni códigos.
import { formatearFecha, formatearHora } from "@/lib/fechas";
import { formatearDni } from "@/lib/ventas/datos";

import type { DatosPuerta, Escaneado, MotivoNoValida } from "./escanear";

export type PersonaPuerta = { titular: string | null; dni: string | null; tipo: string; compra: number };

export type RespuestaPuerta =
  | { resultado: "pasa"; persona: PersonaPuerta }
  // entro: "a las 23:41, hace 3 minutos" (sin el "hace" pasada la hora; con el
  // día, pasadas 12 horas); por: quién la escaneó ("vos" = la misma cuenta).
  | { resultado: "ya_ingreso"; persona: PersonaPuerta; entro: string | null; por: string | null }
  | { resultado: "no_valida"; motivo: MotivoNoValida; persona?: PersonaPuerta };

// Errores (sin resultado): la puerta los muestra como NO VÁLIDA, nunca como PASA.
export type ErrorPuerta = { error: "sesion" | "evento" | "pedido" | "conexion" };

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

function persona(datos: DatosPuerta): PersonaPuerta {
  return { titular: datos.titular, dni: datos.dni ? formatearDni(datos.dni) : null, tipo: datos.tipo, compra: datos.compra };
}

export function respuestaPuerta(escaneado: Escaneado, usuarioId: string, ahora = new Date()): RespuestaPuerta {
  switch (escaneado.resultado) {
    case "pasa":
      return { resultado: "pasa", persona: persona(escaneado.entrada) };
    case "ya_ingreso": {
      const { usadaEn, validadaPor } = escaneado;
      const entro = usadaEn ? cuandoEntro(usadaEn, ahora) : null;
      const por = !validadaPor ? null : validadaPor.id === usuarioId ? "vos" : validadaPor.nombre;
      return { resultado: "ya_ingreso", persona: persona(escaneado.entrada), entro, por };
    }
    case "no_valida":
      return {
        resultado: "no_valida",
        motivo: escaneado.motivo,
        ...(escaneado.entrada && { persona: persona(escaneado.entrada) }),
      };
  }
}
