// La configuración del servidor de mail y los motivos de un mail que no salió.
import { describe, expect, it } from "vitest";

import { carteroSmtp, configuracionSmtp, describirErrorDeMail, enUnRenglon } from "./cartero";

const GMAIL = { SMTP_HOST: "smtp.gmail.com", SMTP_USUARIO: "entradas@gmail.com", SMTP_CLAVE: "abcd efgh ijkl mnop" };

describe("Servidor de mail", () => {
  it("con las cuatro variables de Gmail: puerto 465 y la contraseña sin espacios", () => {
    expect(configuracionSmtp(GMAIL)).toEqual({
      host: "smtp.gmail.com",
      puerto: 465,
      usuario: "entradas@gmail.com",
      clave: "abcdefghijklmnop",
      desde: "entradas@gmail.com",
    });
    expect(configuracionSmtp({ ...GMAIL, SMTP_PUERTO: "587", MAIL_DESDE: "entradas@midominio.com" })).toMatchObject({
      puerto: 587,
      desde: "entradas@midominio.com",
    });
  });

  it("si falta algo (o el puerto no es un número), no hay cartero", () => {
    for (const falta of ["SMTP_HOST", "SMTP_USUARIO", "SMTP_CLAVE"] as const) {
      expect(configuracionSmtp({ ...GMAIL, [falta]: " " })).toBeNull();
    }
    expect(configuracionSmtp({ ...GMAIL, SMTP_PUERTO: "abc" })).toBeNull();
    expect(carteroSmtp({})).toBeNull();
    expect(carteroSmtp(GMAIL)).not.toBeNull();
  });

  it("el motivo de un mail que no salió nunca repite lo que dijo el servidor (puede traer el email)", () => {
    const con = (cambios: object) => Object.assign(new Error("550 <comprador@ejemplo.com> rechazado"), cambios);
    expect(describirErrorDeMail(con({ code: "EAUTH" }))).toMatch(/usuario o la contraseña/);
    expect(describirErrorDeMail(con({ responseCode: 550, response: "550-5.4.5 Daily user sending limit exceeded" }))).toMatch(
      /límite de mails por día/,
    );
    expect(describirErrorDeMail(con({ code: "ETIMEDOUT" }))).toBe("No se pudo conectar con el servidor de mail.");
    expect(describirErrorDeMail(con({ code: "EENVELOPE", responseCode: 550 }))).toMatch(/no aceptó el destinatario/);
    expect(describirErrorDeMail(con({ code: "EMESSAGE", responseCode: 552 }))).toBe("El servidor de mail rechazó el envío (código 552).");
    expect(describirErrorDeMail(con({}))).toBe("Falló al armar o mandar el mail.");
    expect(describirErrorDeMail("texto")).toBe("Falló al armar o mandar el mail.");
    expect(describirErrorDeMail(null)).toBe("Falló al armar o mandar el mail.");
  });

  it("enUnRenglon saca saltos de línea y caracteres de control, y corta lo largo", () => {
    expect(enUnRenglon("Hola\r\nBcc: x@y.com\t\u0000 chau")).toBe("Hola Bcc: x@y.com chau");
    expect(enUnRenglon("a".repeat(200), 10)).toBe(`${"a".repeat(9)}…`);
  });
});
