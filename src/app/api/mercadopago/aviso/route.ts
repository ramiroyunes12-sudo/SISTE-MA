import { obtenerDb } from "@/lib/db";
import { mandarMailsDespues } from "@/lib/mails/despues";
import { procesarAviso } from "@/lib/pagos/cobros";
import { apiMercadoPago } from "@/lib/pagos/mercadopago";

// POST /api/mercadopago/aviso?p=<productora>: Mercado Pago avisa que hay
// novedades de un pago (webhook). Este link solo lo conoce Mercado Pago (va en
// cada cobro); sin ?p= no se hace nada. El aviso solo trae el número del
// pago: el pago de verdad se le pide a Mercado Pago con el token de la
// productora, así un aviso inventado no confirma nada.
//
// Formatos que manda Mercado Pago: {"type":"payment","data":{"id":"123"}} en
// el cuerpo, o ?type=payment&data.id=123 / ?topic=payment&id=123 en el link.
// Respuestas: 200 si se procesó o no era para nosotros (sin decir qué pasó);
// 500 si falló algo de nuestro lado (Mercado Pago vuelve a avisar más tarde).
export async function POST(request: Request) {
  const url = new URL(request.url);
  const productoraId = url.searchParams.get("p");
  const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const datos = (cuerpo?.data ?? {}) as Record<string, unknown>;
  const tipo = String(cuerpo?.type ?? cuerpo?.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
  const pagoId = String(datos.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
  if (!productoraId || tipo !== "payment" || !/^\d{1,20}$/.test(pagoId)) return Response.json({ ok: true });

  try {
    const resultado = await procesarAviso(obtenerDb(), { productoraId, pagoId }, apiMercadoPago);
    // Si dio entradas, el mail sale después de responder.
    if (resultado === "confirmada" || resultado === "confirmada_tarde") mandarMailsDespues();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[aviso Mercado Pago] Falló:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
