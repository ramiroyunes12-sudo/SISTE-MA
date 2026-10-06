# Sistema de venta de entradas — Plan

Plataforma para vender entradas por lotes, enviar el QR por mail y validarlo en la puerta. La usan varias **productoras** (se alquila por evento): cada una maneja solo sus eventos y sus números.

## Alcance

| Área | Incluye |
|---|---|
| Lotes | Tipos de entrada (General, VIP…) con Lote 1 → 2 → 3. Cambio **automático por cantidad**: al agotarse un lote se abre el siguiente. |
| Venta | Checkout con Mercado Pago, sin cargo extra al comprador. Reserva de stock ~10 min mientras paga. Máximo de entradas por compra. |
| Entradas | Nominativas (nombre + DNI). Un QR firmado por entrada, enviado por mail (+ PDF adjunto). |
| Comprador | "Mis entradas": reenviar el mail ingresando email + DNI. |
| Cortesías | Individuales, carga masiva por Excel/CSV, cupo aparte del stock en venta. |
| Puerta | Escáner web desde el celular (solo online), búsqueda por DNI/nombre, contador en vivo. Resultados: PASA / YA INGRESÓ / NO VÁLIDA. |
| Panel admin | Resumen (recaudación, ventas por lote, ingresos), evento y lotes, ventas (reenviar, anular, reembolsar), cortesías, validadores, exportar a Excel. Cada productora ve solo lo suyo. |
| Productoras | El dueño de la plataforma crea productoras y su gente (organizadores y validadores) con su email y contraseña temporal; puede desactivarlas. |
| Cobros | Cada productora conecta **su propio Mercado Pago**: la plata de las entradas le llega directo. El dueño cobra un **alquiler fijo por evento**, aparte del sistema. |
| Mails | Gmail SMTP para arrancar (< 500 por día en total); con varias productoras conviene pasar a un servicio de mails con dominio propio (Resend). |

**Fuera de alcance:** que las productoras se registren solas (las crea el dueño), comisión automática por entrada, lotes por fecha o manuales, cupones, links de RRPP, cuentas con login para compradores, transferencias, cargo por servicio, modo sin internet.

## Seguridad del QR

- El QR lleva un código aleatorio largo firmado con HMAC (no IDs correlativos).
- El servidor decide siempre: marcar como "usada" es una operación atómica, así un QR entra una sola vez aunque lo escaneen dos celulares a la vez.
- Los validadores solo acceden al escáner y a la búsqueda por DNI, y solo de los eventos de su productora.
- Roles: **ADMIN** (dueño de la plataforma: todo), **ORGANIZADOR** (de una productora: sus eventos y números), **VALIDADOR** (de una productora: solo la puerta). Qué ve cada uno lo decide un único lugar del código (`src/lib/auth/alcance.ts`).

## Stack

- **Next.js (TypeScript)**: página pública, panel y escáner en una sola app.
- **PostgreSQL** (Supabase o Neon).
- **Mercado Pago** Checkout Pro + webhooks.
- **Nodemailer + Gmail SMTP** (después Resend).
- `qrcode`, `pdf-lib`, `html5-qrcode`, `exceljs`.
- Hosting: Vercel + Supabase.

## Modelo de datos

```
Productora   (id, nombre, activa)
Evento       (id, productora_id, nombre, fecha, lugar, flyer, max_por_compra, cupo_cortesias, publicado)
TipoEntrada  (id, evento_id, nombre)
Lote         (id, tipo_id, nombre, precio, cupo, vendidas, orden, estado)
Orden        (id, evento_id, email, telefono, total, estado, mp_payment_id, expira_en)
Entrada      (id, orden_id, lote_id, titular, dni, codigo, es_cortesia, estado, usada_en, usada_por)
Usuario      (id, nombre, email, rol: admin | organizador | validador, productora_id)
Escaneo      (id, entrada_id, usuario_id, resultado, fecha)
```

## Etapas

1. Base del proyecto, modelo de datos, panel de evento y lotes.
2. Checkout con Mercado Pago, generación de QR y envío por mail.
3. Escáner, búsqueda por DNI y contador en vivo.
4. Cortesías (individual, masiva, cupo) y reenvío de entradas.
5. Resumen, exportar a Excel y reembolsos.

## Diseño

Borrador de interfaz (15 pantallas): https://claude.ai/artifact/TEQZ3qY3s5V2eufJfgSWtJ
