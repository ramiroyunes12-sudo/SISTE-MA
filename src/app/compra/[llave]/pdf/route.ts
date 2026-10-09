// GET /compra/<llave>/pdf: las entradas de la compra en PDF (todas) y
// /compra/<llave>/pdf?entrada=2: solo esa (para pasársela a quien va).
// Como la página de la compra, la llave del link es el permiso: solo la tiene
// quien compró. El PDF se arma en el momento y no se guarda.
import type { NextRequest } from "next/server";

import { obtenerDb } from "@/lib/db";
import { leerNumeroDeEntrada, pdfDeCompra } from "@/lib/entradas/descarga";

const SIN_GUARDAR = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: NextRequest, ctx: RouteContext<"/compra/[llave]/pdf">) {
  const { llave } = await ctx.params;
  const numero = leerNumeroDeEntrada(request.nextUrl.searchParams.get("entrada"));
  if (numero === "invalido") return texto("No encontramos esa entrada.", 404);

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
      // inline: se abre en el visor del celu (en iPhone y en el navegador de
      // WhatsApp o Instagram "attachment" a veces no hace nada); desde ahí se
      // guarda o se comparte. El nombre es solo con números, sin datos de nadie.
      "Content-Disposition": `inline; filename="${resultado.archivo}"`,
    },
  });
}

function texto(mensaje: string, status: number) {
  return new Response(mensaje, { status, headers: { ...SIN_GUARDAR, "Content-Type": "text/plain; charset=utf-8" } });
}
