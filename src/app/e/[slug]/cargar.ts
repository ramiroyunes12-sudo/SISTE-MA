// El evento de /e/<slug> y de su checkout, como lo puede ver quien entra:
// el público, si está publicado (o finalizado) y la productora activa; si
// no, solo su gente, como vista previa. null = para esta persona no existe.
import "server-only";

import { connection } from "next/server";
import { cache } from "react";

import { obtenerSesionActual } from "@/lib/auth/actual";
import { obtenerDb } from "@/lib/db";
import { SLUG } from "@/lib/eventos/editor";
import { buscarEventoPublico, loVeElPublico, puedeVerVistaPrevia } from "@/lib/eventos/publico";
import { liberarVencidas } from "@/lib/ventas/ordenes";

// Una vez por pedido (la usan la página, los metadatos y las acciones).
export const cargarEventoParaMostrar = cache(async (slug: string) => {
  // Siempre al momento: el lote en venta cambia con cada compra.
  await connection();
  if (!SLUG.test(slug) || slug.length > 100) return null;
  let evento = await buscarEventoPublico(obtenerDb(), slug);
  if (!evento) return null;
  // Si hay reservas vencidas, sus lugares vuelven antes de mostrar el lote en venta.
  const liberadas = await liberarVencidas(obtenerDb(), evento.id).catch((error: unknown) => {
    console.warn("[liberarVencidas] No se pudo:", error);
    return 0;
  });
  if (liberadas > 0) evento = (await buscarEventoPublico(obtenerDb(), slug)) ?? evento;
  if (loVeElPublico(evento)) return { evento, vistaPrevia: false };
  // Borrador, o productora desactivada: solo su gente lo ve, como vista previa.
  const sesion = await obtenerSesionActual();
  return puedeVerVistaPrevia(sesion?.usuario ?? null, evento) ? { evento, vistaPrevia: true } : null;
});
