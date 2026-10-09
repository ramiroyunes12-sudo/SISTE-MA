// GET /compra/<llave>/pdf: las entradas de la compra en PDF (todas) y
// /compra/<llave>/pdf?entrada=2: solo esa (para pasársela a quien va).
// Como la página de la compra, la llave del link es el permiso: solo la tiene
// quien compró. El PDF se arma en el momento y no se guarda.
import type { NextRequest } from "next/server";

import { obtenerDb } from "@/lib/db";
import { pdfDeCompra } from "@/lib/entradas/imprimir";

const SIN_GUARDAR = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function GET(request: NextRequest, ctx: RouteContext<"/compra/[llave]/pdf">) {
  const { llave } = await ctx.params;
  const pedida = request.nextUrl.searchParams.get("entrada");
  const numero = pedida === null ? null : /^[1-9]\d{0,2}$/.test(pedida) ? Number(pedida) : NaN;
  if (Number.isNaN(numero)) return texto("No encontramos esa entrada.", 404);

  let resultado: Awaited<ReturnType<typeof pdfDeCompra>>;
  try {
    resultado = await pdfDeCompra(obtenerDb(), llave, numero);
  } catch (error) {
    // Sin datos de la compra en el log (puede traer nombres): solo qué falló.
    console.error("[pdf de la compra] No se pudo armar:", error instanceof Error ? error.message : "error desconocido");
    return texto("Las entradas no están disponibles ahora. Probá de nuevo en un rato.", 503);
  }
  if (!resultado.ok) return texto("No encontramos entradas para descargar en esta compra.", 404);

  return new Response(Buffer.from(resultado.pdf), {
    headers: {
      ...SIN_GUARDAR,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${resultado.archivo}"`,
    },
  });
}

function texto(mensaje: string, status: number) {
  return new Response(mensaje, { status, headers: { ...SIN_GUARDAR, "Content-Type": "text/plain; charset=utf-8" } });
}
