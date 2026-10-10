// El WhatsApp para consultas de quien compra (el de la plataforma). Va en el
// mail con las entradas, en el PDF y en la página de la compra. El mail no
// recibe respuestas: para cualquier problema, este número.
//
// Se carga en Vercel, en WHATSAPP_AYUDA, como se quiere mostrar y con el
// código de país: "+54 9 379 412-3456". Para el link se usan solo los
// números. Sin la variable (o si no parece un número), no se muestra nada.
import { enumerar } from "./texto";

export type WhatsappDeAyuda = {
  numero: string; // como se muestra
  // Abre el chat con el mensaje (y la compra, o la cortesía) ya escrito.
  link: (compras?: number | readonly number[], cortesia?: boolean) => string;
};

export function whatsappDeAyuda(env: Record<string, string | undefined> = process.env): WhatsappDeAyuda | null {
  const numero = (env.WHATSAPP_AYUDA ?? "").replace(/\s+/g, " ").trim();
  const digitos = numero.replace(/\D/g, "");
  if (!/^\+?[\d\s().-]+$/.test(numero) || digitos.length < 10 || digitos.length > 15) return null;
  return {
    numero,
    link: (compras, cortesia = false) => {
      const numeros = typeof compras === "number" ? [compras] : (compras ?? []);
      const [una, varias] = cortesia ? ["la cortesía", "las cortesías"] : ["la compra", "las compras"];
      const texto =
        numeros.length > 1
          ? `Hola, tengo una consulta por ${varias} N° ${enumerar(numeros)}`
          : numeros.length === 1
            ? `Hola, tengo una consulta por ${una} N° ${numeros[0]}`
            : "Hola, tengo una consulta por una compra";
      return `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}`;
    },
  };
}
