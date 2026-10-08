---
paths:
  - "src/**"
---
# Datos de compradores y secretos
- Nombre, DNI, email y celular son datos personales (Ley 25.326).
- Nunca en una URL ni en query strings (Vercel guarda las URLs en sus logs): reenviar entradas y buscar por DNI van por acción del servidor (POST).
- Nunca en `console.*` ni en mensajes de error al cliente: loguear ids de orden o entrada, no el objeto de la compra.
- Nunca en `localStorage` ni `sessionStorage`.
- El QR lleva solo el código aleatorio firmado, nunca DNI ni nombre.
- Fuera de React (HTML del mail, PDF) escapar nombre y DNI; nunca `dangerouslySetInnerHTML` con datos de la gente.
- Cada acción y ruta nueva: `requerirUsuario()` y el filtro de `src/lib/auth/alcance.ts` sobre el registro que toca (la puerta y la exportación solo ven su productora).
- Las claves (HMAC, SMTP, Mercado Pago, cifrado) nunca con `NEXT_PUBLIC_`, nunca en el repo ni en el chat: solo en Vercel o en el `.env`.
