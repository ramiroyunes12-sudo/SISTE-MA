// GET /admin/cortesias/<evento>/pdf/<orden>: el PDF de una cortesía, para
// pasársela a la persona (por ejemplo, si no tiene email). Solo quien puede
// ver el evento en el panel (su organizador o el ADMIN). Se arma en el
// momento y no se guarda.
import { requerirUsuario } from "@/lib/auth/actual";
import { alcanceDe } from "@/lib/auth/alcance";
import { pdfDeCortesia } from "@/lib/cortesias/cortesias";
import { obtenerDb } from "@/lib/db";

const SIN_GUARDAR = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(_request: Request, ctx: RouteContext<"/admin/cortesias/[id]/pdf/[orden]">) {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  const { id, orden } = await ctx.params;
  let resultado: Awaited<ReturnType<typeof pdfDeCortesia>>;
  try {
    resultado = await pdfDeCortesia(obtenerDb(), { eventoId: id, alcance: alcanceDe(usuario) }, orden);
  } catch (error) {
    // Sin datos de la persona en el log: solo qué falló.
    console.error("[pdf de la cortesía] No se pudo armar:", error instanceof Error ? error.message : "error desconocido");
    return texto("La entrada no está disponible ahora. Probá de nuevo en un rato.", 503);
  }
  if (!resultado.ok) return texto("No encontramos esa cortesía (o está anulada).", 404);
  return new Response(Buffer.from(resultado.pdf), {
    headers: {
      ...SIN_GUARDAR,
      "Content-Type": "application/pdf",
      // inline: se abre en el visor (desde ahí se guarda o se comparte). El
      // nombre es solo con números, sin datos de nadie.
      "Content-Disposition": `inline; filename="${resultado.archivo}"`,
    },
  });
}

function texto(mensaje: string, status: number) {
  return new Response(mensaje, { status, headers: { ...SIN_GUARDAR, "Content-Type": "text/plain; charset=utf-8" } });
}
