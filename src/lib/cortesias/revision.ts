// Revisar cada cortesía antes de darla: nombre y apellido, DNI, email
// (opcional) y tipo de entrada. Las mismas reglas que el checkout para el
// nombre y el DNI (en la puerta se busca por DNI y el nombre va impreso en la
// entrada). Sin nada del servidor: lo usa también la pantalla.
import {
  errorDeDni,
  errorDeEmail,
  errorDeNombre,
  normalizarDni,
  normalizarNombre,
} from "@/lib/ventas/datos";

import { comparable, type FilaPlanilla } from "./planilla";

export type TipoCortesia = { id: string; nombre: string };

export type CortesiaRevisada = {
  fila: number; // su número en la planilla (1 en "Dar una cortesía")
  nombre: string;
  dni: string; // solo números
  email: string | null;
  tipoId: string | null;
  tipo: string; // el nombre del tipo (o lo que escribieron, si no existe)
  errores: string[]; // vacío si está bien
};

export const MAX_FILAS = 200; // por carga (el cupo de mails de Gmail es de ~500 por día)

// Para comparar DNI: sin puntos ni ceros adelante ("04.123.456" = "4123456").
export function claveDni(dni: string) {
  return normalizarDni(dni).replace(/^0+/, "");
}

// Revisa las filas. `tipoPorDefecto`: el de las filas que no dicen el tipo.
// Un DNI repetido en la lista es un error en la segunda vez que aparece.
export function revisarFilas(
  filas: FilaPlanilla[],
  tipos: TipoCortesia[],
  tipoPorDefecto: TipoCortesia | null,
): CortesiaRevisada[] {
  const porNombre = new Map(tipos.map((tipo) => [comparable(tipo.nombre), tipo]));
  const vistos = new Map<string, number>();
  return filas.map((fila) => {
    const errores: string[] = [];
    const nombre = normalizarNombre(fila.nombre);
    const errorNombre = nombre ? errorDeNombre(nombre) : "Falta el nombre y apellido.";
    if (errorNombre) errores.push(errorNombre);

    const dni = normalizarDni(fila.dni.trim());
    const errorDni = dni ? errorDeDni(dni) : "Falta el DNI.";
    if (errorDni) errores.push(errorDni);
    else {
      const antes = vistos.get(claveDni(dni));
      if (antes !== undefined) errores.push(`Este DNI ya está en la fila ${antes}.`);
      else vistos.set(claveDni(dni), fila.fila);
    }

    const email = fila.email.trim().toLowerCase();
    if (email && errorDeEmail(email)) errores.push("Ese email no parece válido.");

    let tipo = tipoPorDefecto;
    if (fila.tipo.trim()) {
      tipo = porNombre.get(comparable(fila.tipo)) ?? null;
      if (!tipo) errores.push(`No hay un tipo "${fila.tipo.trim()}" en este evento (hay: ${tipos.map((t) => t.nombre).join(", ")}).`);
    } else if (!tipo) errores.push("Falta el tipo de entrada.");

    return {
      fila: fila.fila,
      nombre,
      dni,
      email: email || null,
      tipoId: tipo?.id ?? null,
      tipo: tipo?.nombre ?? fila.tipo.trim(),
      errores,
    };
  });
}
