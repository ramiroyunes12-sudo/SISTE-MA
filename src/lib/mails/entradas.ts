// El mail con las entradas de una compra (como el diseño "Mail con el QR"):
// el evento, el QR de cada entrada con su nombre, DNI, tipo y lote, y
// adjuntos el PDF con todas y, con 2 o más, uno por persona (para pasarle a
// cada uno la suya). El mail no recibe respuestas: para cualquier problema,
// el WhatsApp de la plataforma (src/lib/ayuda.ts).
//
// Los QR van como imágenes adjuntas que el mail nombra por su cid: Gmail no
// muestra SVG ni imágenes "data:". Todo se arma en el momento desde la base;
// no se guarda nada.
//
// Un reenvío ("Reenviar mis entradas") lleva otro asunto: con el mismo, Gmail
// lo mete en la conversación del primer mail de esa compra y parece que no
// llegó nada nuevo.
import type { WhatsappDeAyuda } from "@/lib/ayuda";
import type { EntradaConQr } from "@/lib/entradas/imprimir";
import { tipoYLote } from "@/lib/entradas/imprimir";
import { armarPdfEntradas, type DatosPdf } from "@/lib/entradas/pdf";
import { qrPng } from "@/lib/entradas/qr";
import { formatearFechaLarga } from "@/lib/fechas";
import { formatearDni } from "@/lib/ventas/datos";

import { type Adjunto, enUnRenglon, type Mensaje } from "./cartero";

export type DatosMailEntradas = {
  para: string;
  productora: { nombre: string };
  ayuda: WhatsappDeAyuda | null; // el WhatsApp para consultas (si está cargado)
  compra: number; // N° de compra
  totalEntradas: number; // todas las de la compra (también las anuladas): "Entrada 2 de 3"
  evento: { nombre: string; fecha: Date; lugar: string; direccion: string | null };
  entradas: EntradaConQr[]; // las que tienen QR
  reenvio?: boolean; // lo pidieron de nuevo ("Reenviar mis entradas")
};

const TINTA = "#15171C";
const TENUE = "#5B5F69";
const FONDO = "#EDEDE8";
const ACENTO = "#3B3BE8";

// Para meter texto de la gente (o del evento) en el HTML del mail.
export function escaparHtml(texto: string) {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const cid = (numero: number) => `qr-entrada-${numero}@entradas`;

export async function armarMailEntradas(datos: DatosMailEntradas): Promise<Mensaje> {
  if (datos.entradas.length === 0) throw new Error("Mail sin entradas");
  const { evento } = datos;
  const lugar = evento.direccion ? `${evento.lugar} · ${evento.direccion}` : evento.lugar;
  const fecha = formatearFechaLarga(evento.fecha);
  const una = datos.entradas.length === 1;
  const cantidad = una ? "tu entrada" : `tus ${datos.entradas.length} entradas`;
  // El primer renglón: "Acá están tus 2 entradas (compra N° 12)." o, en un
  // reenvío, que son las mismas de antes.
  const saludo = datos.reenvio
    ? `Te reenviamos ${cantidad} (compra N° ${datos.compra}), como se pidió. ${una ? "Es la misma de antes: el QR no cambia." : "Son las mismas de antes: los QR no cambian."}`
    : `${una ? "Acá está" : "Acá están"} ${cantidad} (compra N° ${datos.compra}).`;
  const variasEnLaCompra = datos.totalEntradas > 1;
  // Para terminar una oración con un nombre sin que quede ".." ("S.R.L.").
  const alFinal = (texto: string) => texto.replace(/[.\s]+$/, "");
  const archivoTodas = `entradas-compra-${datos.compra}.pdf`;
  const archivoDe = (entrada: EntradaConQr) => `entrada-${entrada.numero}-compra-${datos.compra}.pdf`;

  // ─── Adjuntos ───
  const datosPdf = (entradas: EntradaConQr[]): DatosPdf => ({
    evento,
    compra: datos.compra,
    totalEntradas: datos.totalEntradas,
    whatsapp: datos.ayuda?.numero,
    entradas: entradas.map((entrada) => ({ ...entrada, usada: entrada.estado === "USADA" })),
  });
  const pdf = (archivo: string, contenido: Uint8Array): Adjunto => ({ archivo, contenido, tipo: "application/pdf" });
  const adjuntos: Adjunto[] = datos.entradas.map((entrada) => ({
    archivo: `qr-entrada-${entrada.numero}.png`,
    contenido: qrPng(entrada.codigoFirmado),
    tipo: "image/png",
    cid: cid(entrada.numero),
  }));
  adjuntos.push(pdf(archivoTodas, await armarPdfEntradas(datosPdf(datos.entradas))));
  if (!una) {
    for (const entrada of datos.entradas) adjuntos.push(pdf(archivoDe(entrada), await armarPdfEntradas(datosPdf([entrada]))));
  }

  // ─── HTML ───
  const e = escaparHtml;
  const tarjetas = datos.entradas
    .map((entrada) => {
      const titulo = variasEnLaCompra ? `ENTRADA ${entrada.numero} DE ${datos.totalEntradas}` : "TU ENTRADA";
      return `
<tr><td align="center" style="background:#FFFFFF;border-radius:14px;padding:20px;text-align:center;">
  <div style="font-size:13px;font-weight:700;color:${TENUE};letter-spacing:0.04em;">${titulo}</div>
  <img src="cid:${cid(entrada.numero)}" width="220" height="220" alt="QR de la entrada ${entrada.numero}" style="display:block;width:220px;height:220px;margin:12px auto;border:0;background:#FFFFFF;">
  <div style="font-size:18px;font-weight:700;color:${TINTA};">${e(entrada.titular)}</div>
  <div style="font-size:14px;color:${TENUE};margin-top:2px;">DNI ${e(formatearDni(entrada.dni))} · ${e(tipoYLote(entrada))}</div>
  ${entrada.estado === "USADA" ? `<div style="font-size:13px;font-weight:700;color:${TENUE};margin-top:6px;">YA USADA</div>` : ""}
  <div style="font-size:11px;color:${TENUE};margin-top:8px;font-family:'Courier New',monospace;word-break:break-all;">Código: ${e(entrada.codigoFirmado)}</div>
  ${una ? "" : `<div style="font-size:12px;color:${TENUE};margin-top:6px;">Su PDF: ${archivoDe(entrada)}</div>`}
</td></tr>
<tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>`;
    })
    .join("");
  const pdfs = una
    ? "También va adjunta en PDF."
    : "También van adjuntas en PDF: un archivo con todas y uno por persona, para mandarle a cada uno la suya.";
  const { ayuda } = datos;
  const whatsapp = ayuda
    ? `
<tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>
<tr><td style="background:#FFFFFF;border-radius:14px;padding:16px 20px;font-size:14px;line-height:1.6;">
  <div style="font-weight:700;font-size:15px;">¿Algún problema?</div>
  Escribinos por WhatsApp: <a href="${e(ayuda.link(datos.compra))}" style="color:${ACENTO};font-weight:700;">${e(ayuda.numero)}</a>
</td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${e(`Tus entradas para ${evento.nombre}`)}</title>
</head>
<body style="margin:0;padding:0;background:${FONDO};">
<div style="display:none;mso-hide:all;max-height:0;overflow:hidden;">Compra N° ${datos.compra}: ${datos.reenvio ? "te reenviamos " : ""}${cantidad} con QR para ${e(alFinal(evento.nombre))}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FONDO};">
<tr><td align="center" style="padding:16px 12px;">
<!--[if mso]><table role="presentation" width="480" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;font-family:Arial,Helvetica,sans-serif;color:${TINTA};">
<tr><td style="background:${TINTA};color:#FFFFFF;border-radius:14px;padding:20px;">
  <div style="font-size:22px;font-weight:800;line-height:1.25;">${e(evento.nombre)}</div>
  <div style="font-size:15px;margin-top:6px;">${e(fecha)}</div>
  <div style="font-size:15px;margin-top:2px;">${e(lugar)}</div>
</td></tr>
<tr><td style="padding:16px 4px;font-size:15px;line-height:1.5;">
  ¡Hola! ${saludo} En la puerta mostrá el QR desde el celular o impreso, junto con el DNI.
</td></tr>
${tarjetas}
<tr><td style="background:#FFFFFF;border-radius:14px;padding:16px 20px;font-size:14px;line-height:1.6;">
  <div style="font-weight:700;font-size:15px;">Importante</div>
  • Cada persona entra con su QR y su DNI.<br>
  • Cada QR sirve para entrar una sola vez: el primero que lo usa, entra.<br>
  • No lo publiques ni lo compartas con quien no va.<br>
  • ${pdfs}
</td></tr>${whatsapp}
<tr><td style="padding:16px 4px;font-size:12px;line-height:1.5;color:${TENUE};">
  Te llega este mail porque compraste entradas para ${e(evento.nombre)} de ${e(datos.productora.nombre)} con esta dirección. Se manda solo: no respondas, nadie lo lee.
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  // ─── Texto ───
  const lineas = datos.entradas.flatMap((entrada) => [
    `${variasEnLaCompra ? `Entrada ${entrada.numero} de ${datos.totalEntradas}` : "Tu entrada"}: ${entrada.titular} · DNI ${formatearDni(entrada.dni)} · ${tipoYLote(entrada)}${entrada.estado === "USADA" ? " · YA USADA" : ""}`,
    `Código: ${entrada.codigoFirmado}`,
    ...(una ? [] : [`Su PDF: ${archivoDe(entrada)}`]),
    "",
  ]);
  const texto = [
    `Tus entradas para ${evento.nombre}`,
    fecha,
    lugar,
    "",
    `¡Hola! ${saludo} ${una ? "El QR está en el PDF adjunto" : "El QR de cada una está en los PDF adjuntos"}: en la puerta mostralo desde el celular o impreso, junto con el DNI.`,
    "",
    ...lineas,
    "Importante: cada persona entra con su QR y su DNI. Cada QR sirve para entrar una sola vez (el primero que lo usa, entra). No lo publiques ni lo compartas con quien no va.",
    una ? `Adjunto: ${archivoTodas}.` : `Adjuntos: ${archivoTodas} (todas) y uno por persona.`,
    ...(ayuda ? ["", `¿Algún problema? Escribinos por WhatsApp: ${ayuda.numero} (${ayuda.link(datos.compra)})`] : []),
    "",
    `Te llega este mail porque compraste entradas para ${evento.nombre} de ${datos.productora.nombre} con esta dirección. Se manda solo: no respondas, nadie lo lee.`,
  ].join("\n");

  return {
    para: datos.para,
    nombreRemitente: enUnRenglon(datos.productora.nombre, 80),
    // Con el N° de compra: si no, Gmail junta en una conversación las de un
    // mismo evento. Y el reenvío, con otro asunto (ver arriba).
    asunto: `${datos.reenvio ? "Te reenviamos tus entradas" : "Tus entradas"} para ${enUnRenglon(evento.nombre, 100)} (compra N° ${datos.compra})`,
    html,
    texto,
    adjuntos,
  };
}
