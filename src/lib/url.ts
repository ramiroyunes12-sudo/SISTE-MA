// La dirección pública del sistema (para los links que se mandan afuera: a
// dónde vuelve Mercado Pago y a dónde avisa). En producción, la de Vercel;
// si no, la de la página que se está mirando.
import "server-only";

import { headers } from "next/headers";

export async function urlPublica() {
  const fija = process.env.URL_PUBLICA?.trim();
  if (fija) return fija.replace(/\/+$/, "");
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  const encabezados = await headers();
  const host = encabezados.get("x-forwarded-host") ?? encabezados.get("host") ?? "localhost:3000";
  const protocolo = encabezados.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocolo}://${host}`;
}
