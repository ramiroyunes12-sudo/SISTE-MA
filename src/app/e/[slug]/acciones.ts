"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import { obtenerDb } from "@/lib/db";
import { esperoDemasiado } from "@/lib/errores-db";
import { crearReserva } from "@/lib/ventas/ordenes";
import { origenDeLaVisita } from "@/lib/ventas/origen";

import { cargarEventoParaMostrar } from "./cargar";

export type EstadoReserva = { error?: string };

const MUCHA_GENTE = "Hay mucha gente comprando en este momento. Probá de nuevo en unos segundos.";

// "Continuar": reserva las entradas por 10 minutos y lleva a la compra.
export async function reservarAccion(slug: string, _anterior: EstadoReserva, formulario: FormData): Promise<EstadoReserva> {
  let llave: string;
  try {
    const cargado = await cargarEventoParaMostrar(String(slug));
    if (!cargado) return { error: "Este evento ya no está disponible." };
    const resultado = await crearReserva(obtenerDb(), cargado.evento.id, formulario.get("p"), await origenDeLaVisita());
    if (!resultado.ok) return { error: resultado.error };
    llave = resultado.llave;
  } catch (error) {
    unstable_rethrow(error);
    if (esperoDemasiado(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028")) {
      return { error: MUCHA_GENTE };
    }
    console.error("[reservar] Falló:", error);
    return { error: "No pudimos reservar: falló la conexión con el sistema. Probá de nuevo." };
  }
  redirect(`/compra/${llave}`);
}
