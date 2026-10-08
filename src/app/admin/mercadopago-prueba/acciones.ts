"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requerirUsuario } from "@/lib/auth/actual";
import { crearCobroDePrueba } from "@/lib/pagos/movimientos-mp";

// "Probar cobro de $100": crea el cobro y manda a Mercado Pago. Al terminar,
// Mercado Pago vuelve a la página de prueba.
export async function probarCobroAccion(): Promise<void> {
  await requerirUsuario(["ADMIN"]);
  const host = (await headers()).get("host") ?? "siste-ma.vercel.app";
  const protocolo = host.startsWith("localhost") ? "http" : "https";
  const resultado = await crearCobroDePrueba(
    process.env.MERCADOPAGO_ACCESS_TOKEN,
    `${protocolo}://${host}/admin/mercadopago-prueba?volvio=1`,
  );
  if (!resultado.ok) redirect(`/admin/mercadopago-prueba?error=${encodeURIComponent(resultado.error)}`);
  redirect(resultado.link);
}
