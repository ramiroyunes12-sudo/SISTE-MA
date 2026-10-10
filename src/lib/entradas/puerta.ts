// Lo que ve la puerta después de escanear: el resultado ya armado en texto
// (la pantalla del escáner solo lo muestra). Sin ids ni códigos.
import { formatearFecha, formatearHora } from "@/lib/fechas";
import { formatearDni } from "@/lib/ventas/datos";

import type { DatosPuerta, Escaneado, MotivoNoValida } from "./escanear";

export type PersonaPuerta = { titular: string | null; dni: string | null; tipo: string; compra: number };

export type RespuestaPuerta =
  | { resultado: "pasa"; persona: PersonaPuerta }
  // entro: "a las 23:41" (o con el día, si fue hace más de 12 horas); por: quién la escaneó.
  | { resultado: "ya_ingreso"; persona: PersonaPuerta; entro: string | null; por: string | null }
  | { resultado: "no_valida"; motivo: MotivoNoValida; persona?: PersonaPuerta };

// Errores (sin resultado): la puerta los muestra como NO VÁLIDA, nunca como PASA.
export type ErrorPuerta = { error: "sesion" | "evento" | "pedido" | "conexion" };

const DOCE_HORAS = 12 * 60 * 60 * 1000;

function persona(datos: DatosPuerta): PersonaPuerta {
  return { titular: datos.titular, dni: datos.dni ? formatearDni(datos.dni) : null, tipo: datos.tipo, compra: datos.compra };
}

export function respuestaPuerta(escaneado: Escaneado, usuarioId: string, ahora = new Date()): RespuestaPuerta {
  switch (escaneado.resultado) {
    case "pasa":
      return { resultado: "pasa", persona: persona(escaneado.entrada) };
    case "ya_ingreso": {
      const { usadaEn, validadaPor } = escaneado;
      const entro = !usadaEn
        ? null
        : ahora.getTime() - usadaEn.getTime() < DOCE_HORAS
          ? `a las ${formatearHora(usadaEn)}`
          : `el ${formatearFecha(usadaEn)}`;
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
