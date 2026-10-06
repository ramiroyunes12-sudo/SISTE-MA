"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { alcanceDe, filtroDeEventos } from "@/lib/auth/alcance";
import { obtenerDb } from "@/lib/db";
import { type Errores, validarEvento } from "@/lib/eventos/editor";
import { guardarEvento } from "@/lib/eventos/guardar";
import { type PlanCompra, planearCompra, validarPedido } from "@/lib/ventas/pedido";

export type EstadoGuardado = { errores?: Errores };
export type EstadoSimulacion = { plan?: PlanCompra; error?: string; aviso?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Guarda el evento (nuevo si eventoId es null) con sus tipos y lotes.
export async function guardarEventoDesdeEditor(
  _anterior: EstadoGuardado,
  envio: { eventoId: string | null; evento: unknown },
): Promise<EstadoGuardado> {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);

  const eventoId = envio?.eventoId ?? null;
  if (eventoId !== null && (typeof eventoId !== "string" || !UUID.test(eventoId))) {
    return { errores: { general: "Los datos no son válidos. Recargá la página." } };
  }
  const validacion = validarEvento(envio?.evento);
  // El dueño, al crear, tiene que elegir la productora (se avisa junto con lo demás).
  const elegida = (envio?.evento as { productoraId?: unknown } | undefined)?.productoraId;
  const faltaProductora =
    usuario.rol === "ADMIN" && eventoId === null && !(typeof elegida === "string" && UUID.test(elegida));
  if (!validacion.ok || faltaProductora) {
    return {
      errores: {
        ...(validacion.ok ? {} : validacion.errores),
        ...(faltaProductora ? { productoraId: "Elegí una productora." } : {}),
      },
    };
  }

  let id: string;
  try {
    const resultado = await guardarEvento(obtenerDb(), eventoId, validacion.datos, alcanceDe(usuario));
    if (!resultado.ok) return { errores: resultado.errores };
    id = resultado.id;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[guardarEvento] Falló:", error);
    return { errores: { general: "No pudimos guardar: falló la conexión con el sistema. Probá de nuevo." } };
  }
  redirect(`/admin/eventos/${id}?guardado=1`);
}

// "Probar una compra": cómo se repartiría un pedido en los lotes si alguien
// comprara ahora, con las mismas reglas que la compra de verdad. No reserva
// ni vende nada.
export async function simularCompraAccion(
  eventoId: string,
  _anterior: EstadoSimulacion,
  datos: FormData,
): Promise<EstadoSimulacion> {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  if (!UUID.test(eventoId)) return { error: "Ese evento ya no existe." };
  try {
    const evento = await obtenerDb().evento.findFirst({
      where: { id: eventoId, ...filtroDeEventos(alcanceDe(usuario)) },
      select: {
        estado: true,
        maxPorCompra: true,
        tipos: {
          orderBy: [{ orden: "asc" }, { nombre: "asc" }],
          select: {
            id: true,
            nombre: true,
            lotes: {
              select: { id: true, numero: true, nombre: true, precioCentavos: true, cupo: true, vendidas: true, reservadas: true },
            },
          },
        },
      },
    });
    if (!evento) return { error: "Ese evento ya no existe." };

    const cantidades = evento.tipos.map((tipo) => {
      const texto = String(datos.get(`cantidad-${tipo.id}`) ?? "").trim();
      return { tipoId: tipo.id, cantidad: texto === "" ? 0 : Number(texto) };
    });
    if (cantidades.some(({ cantidad }) => !Number.isInteger(cantidad) || cantidad < 0 || cantidad > 20)) {
      return { error: "Poné cantidades enteras, de 0 a 20." };
    }
    const pedido = validarPedido(cantidades);
    if (!pedido.ok) return { error: pedido.error };
    const plan = planearCompra(evento.tipos, pedido.pedido, evento.maxPorCompra);
    const aviso =
      evento.estado === "PUBLICADO" ? undefined : "Ojo: el evento no está publicado, así que el público todavía no puede comprar.";
    return plan.ok ? { plan, aviso } : { error: plan.error, aviso };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[simularCompra] Falló:", error);
    return { error: "No pudimos hacer la prueba: falló la conexión con el sistema. Probá de nuevo." };
  }
}
