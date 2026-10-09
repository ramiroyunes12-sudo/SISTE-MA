// El WhatsApp para consultas de quien compra (el de la plataforma). Va en el
// mail con las entradas, en el PDF y en la página de la compra. El mail no
// recibe respuestas: para cualquier problema, este número.
//
// Se carga en Vercel, en WHATSAPP_AYUDA, como se quiere mostrar y con el
// código de país: "+54 9 379 412-3456". Para el link se usan solo los
// números. Sin la variable (o si no parece un número), no se muestra nada.

export type WhatsappDeAyuda = {
  numero: string; // como se muestra
  link: (compra?: number) => string; // abre el chat con el mensaje ya escrito
};

export function whatsappDeAyuda(env: Record<string, string | undefined> = process.env): WhatsappDeAyuda | null {
  const numero = (env.WHATSAPP_AYUDA ?? "").replace(/\s+/g, " ").trim();
  const digitos = numero.replace(/\D/g, "");
  if (!/^\+?[\d\s().-]+$/.test(numero) || digitos.length < 10 || digitos.length > 15) return null;
  return {
    numero,
    link: (compra) => {
      const texto = compra ? `Hola, tengo una consulta por la compra N° ${compra}` : "Hola, tengo una consulta por una compra";
      return `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}`;
    },
  };
}
