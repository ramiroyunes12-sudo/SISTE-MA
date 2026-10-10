// El WhatsApp para consultas: se muestra como se cargó y el link usa solo los números.
import { describe, expect, it } from "vitest";

import { whatsappDeAyuda } from "./ayuda";

describe("WhatsApp para consultas", () => {
  it("se muestra como se cargó y el link abre el chat con la compra ya escrita", () => {
    const ayuda = whatsappDeAyuda({ WHATSAPP_AYUDA: "  +54 9 379 412-3456 " })!;
    expect(ayuda.numero).toBe("+54 9 379 412-3456");
    expect(ayuda.link(12)).toBe("https://wa.me/5493794123456?text=Hola%2C%20tengo%20una%20consulta%20por%20la%20compra%20N%C2%B0%2012");
    expect(ayuda.link()).toBe("https://wa.me/5493794123456?text=Hola%2C%20tengo%20una%20consulta%20por%20una%20compra");
    // Varias compras (un mail con todas): las nombra a todas.
    expect(ayuda.link([7, 12, 30])).toBe(
      `https://wa.me/5493794123456?text=${encodeURIComponent("Hola, tengo una consulta por las compras N° 7, 12 y 30")}`,
    );
    expect(ayuda.link([12])).toBe(ayuda.link(12));
  });

  it("sin la variable, o si no parece un número, no hay WhatsApp", () => {
    for (const valor of [undefined, "", "   ", "12345", "+54 9 379 412-3456 <script>", "javascript:alert(1)", "1".repeat(16)]) {
      expect(whatsappDeAyuda({ WHATSAPP_AYUDA: valor })).toBeNull();
    }
  });
});
