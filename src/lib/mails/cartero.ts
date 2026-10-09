// Quién lleva los mails: un servidor SMTP (Gmail con una contraseña de
// aplicación; más adelante puede ser Resend u otro, cambiando las variables).
//
// Variables (solo en Vercel o en el .env, nunca en el repo):
// - SMTP_HOST: smtp.gmail.com
// - SMTP_PUERTO: 465 (o 587)
// - SMTP_USUARIO: la cuenta (cuenta@gmail.com)
// - SMTP_CLAVE: la contraseña de aplicación de esa cuenta
// - MAIL_DESDE (opcional): la dirección que figura como remitente. Con Gmail
//   es la misma cuenta; con otro servicio, una de su dominio.
import { createTransport } from "nodemailer";

export type Adjunto = {
  archivo: string;
  contenido: Uint8Array;
  tipo: string; // "application/pdf", "image/png"
  cid?: string; // si va dentro del mail (la imagen del QR): <img src="cid:...">
};

export type Mensaje = {
  para: string;
  nombreRemitente: string; // el nombre de la productora
  asunto: string;
  html: string;
  texto: string; // lo mismo, para los programas que no muestran HTML
  adjuntos: Adjunto[];
};

export type Cartero = { enviar(mensaje: Mensaje): Promise<void> };

export type ConfiguracionSmtp = { host: string; puerto: number; usuario: string; clave: string; desde: string };

// La configuración, o null si falta algo (entonces no se intenta mandar nada).
export function configuracionSmtp(env: Record<string, string | undefined> = process.env): ConfiguracionSmtp | null {
  const host = env.SMTP_HOST?.trim();
  const usuario = env.SMTP_USUARIO?.trim();
  // Google muestra la contraseña de aplicación en grupos ("abcd efgh ..."): sin espacios.
  const clave = env.SMTP_CLAVE?.replace(/\s+/g, "");
  const puerto = Number(env.SMTP_PUERTO?.trim() || 465);
  const desde = env.MAIL_DESDE?.trim() || usuario;
  if (!host || !usuario || !clave || !desde || !Number.isInteger(puerto) || puerto <= 0 || puerto > 65535) return null;
  return { host, puerto, usuario, clave, desde };
}

// Saca saltos de línea y caracteres de control (no pueden ir en un encabezado del mail).
export function enUnRenglon(texto: string, largo = 120) {
  const limpio = texto.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return limpio.length > largo ? `${limpio.slice(0, largo - 1).trimEnd()}…` : limpio;
}

// El cartero de verdad, o null si no está configurado.
export function carteroSmtp(env: Record<string, string | undefined> = process.env): Cartero | null {
  const config = configuracionSmtp(env);
  if (!config) return null;
  const transporte = createTransport({
    host: config.host,
    port: config.puerto,
    secure: config.puerto === 465, // 465: TLS desde el principio; 587: lo pide con STARTTLS
    requireTLS: config.puerto !== 465,
    auth: { user: config.usuario, pass: config.clave },
    // Que un servidor colgado no deje el envío esperando para siempre (y
    // además, un plazo total: PLAZO_ENVIO_MS).
    dnsTimeout: 10_000,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async enviar(mensaje) {
      const envio = transporte.sendMail({
        from: { name: enUnRenglon(mensaje.nombreRemitente, 80), address: config.desde },
        to: mensaje.para,
        subject: enUnRenglon(mensaje.asunto, 150),
        html: mensaje.html,
        text: mensaje.texto,
        attachments: mensaje.adjuntos.map((adjunto) => ({
          filename: adjunto.archivo,
          content: Buffer.from(adjunto.contenido),
          contentType: adjunto.tipo,
          ...(adjunto.cid ? { cid: adjunto.cid, contentDisposition: "inline" as const } : {}),
        })),
      });
      await conPlazo(envio, PLAZO_ENVIO_MS);
    },
  };
}

// Lo más que se espera a que salga un mail. (pendientes.ts cuenta con esto:
// DURACION_MAXIMA_ENVIO_MS tiene que ser mayor.)
export const PLAZO_ENVIO_MS = 45_000;

function conPlazo<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const vencido = new Promise<never>((_, rechazar) => {
    reloj = setTimeout(() => rechazar(Object.assign(new Error("El envío tardó demasiado"), { code: "ETIMEDOUT" })), ms);
  });
  // Si vence el plazo, lo que pase después con el envío ya no importa.
  promesa.catch(() => {});
  return Promise.race([promesa, vencido]).finally(() => clearTimeout(reloj));
}

// El servidor dice que se llegó al límite de mails por día de la cuenta
// (Gmail: 5.4.5). No es culpa del mail: no cuenta como intento.
export function esLimiteDiario(error: unknown) {
  const respuesta = typeof error === "object" && error !== null ? (error as { response?: unknown }).response : undefined;
  return typeof respuesta === "string" && /\b5\.4\.5\b/.test(respuesta);
}

// Por qué no salió un mail, en palabras simples y sin datos de la persona (el
// servidor a veces repite el email en su respuesta: no se guarda).
export function describirErrorDeMail(error: unknown): string {
  const e = (typeof error === "object" && error !== null ? error : {}) as { code?: unknown; responseCode?: unknown; response?: unknown };
  const codigo = typeof e.code === "string" ? e.code : "";
  if (codigo === "EAUTH") return "El servidor de mail rechazó el usuario o la contraseña (SMTP_USUARIO y SMTP_CLAVE).";
  if (esLimiteDiario(error)) return "Se llegó al límite de mails por día de la cuenta: se vuelve a intentar cada una hora.";
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ECONNRESET", "ETLS"].includes(codigo)) {
    return "No se pudo conectar con el servidor de mail.";
  }
  if (codigo === "EENVELOPE") return "El servidor de mail no aceptó el destinatario: puede que el email esté mal escrito.";
  if (typeof e.responseCode === "number") return `El servidor de mail rechazó el envío (código ${e.responseCode}).`;
  return "Falló al armar o mandar el mail.";
}
