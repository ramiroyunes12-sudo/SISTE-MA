# Sistema de venta de entradas — Plan

Sistema propio (un solo organizador) para vender entradas por lotes, enviar el QR por mail y validarlo en la puerta.

## Alcance

| Área | Incluye |
|---|---|
| Lotes | Tipos de entrada (General, VIP…) con Lote 1 → 2 → 3. Cambio **automático por cantidad**: al agotarse un lote se abre el siguiente. |
| Venta | Checkout con Mercado Pago, sin cargo extra al comprador. Reserva de stock ~10 min mientras paga. Máximo de entradas por compra. |
| Entradas | Nominativas (nombre + DNI). Un QR firmado por entrada, enviado por mail (+ PDF adjunto). |
| Comprador | "Mis entradas": reenviar el mail ingresando email + DNI. |
| Cortesías | Individuales, carga masiva por Excel/CSV, cupo aparte del stock en venta. |
| Puerta | Escáner web desde el celular (solo online), búsqueda por DNI/nombre, contador en vivo. Resultados: PASA / YA INGRESÓ / NO VÁLIDA. |
| Panel admin | Resumen (recaudación, ventas por lote, ingresos), evento y lotes, ventas (reenviar, anular, reembolsar), cortesías, validadores, exportar a Excel. |
| Mails | Gmail SMTP para arrancar (< 500 por evento); migrar a Resend si se compra dominio. |

**Fuera de alcance:** multi-productor, lotes por fecha o manuales, cupones, links de RRPP, cuentas con login para compradores, transferencias, cargo por servicio, modo sin internet.

## Seguridad del QR

- El QR lleva un código aleatorio largo firmado con HMAC (no IDs correlativos).
- El servidor decide siempre: marcar como "usada" es una operación atómica, así un QR entra una sola vez aunque lo escaneen dos celulares a la vez.
- Los validadores solo acceden al escáner y a la búsqueda por DNI.

## Stack

- **Next.js (TypeScript)**: página pública, panel y escáner en una sola app.
- **PostgreSQL** (Supabase o Neon).
- **Mercado Pago** Checkout Pro + webhooks.
- **Nodemailer + Gmail SMTP** (después Resend).
- `qrcode`, `pdf-lib`, `html5-qrcode`, `exceljs`.
- Hosting: Vercel + Supabase.

## Modelo de datos

```
Evento       (id, nombre, fecha, lugar, flyer, max_por_compra, cupo_cortesias, publicado)
TipoEntrada  (id, evento_id, nombre)
Lote         (id, tipo_id, nombre, precio, cupo, vendidas, orden, estado)
Orden        (id, evento_id, email, telefono, total, estado, mp_payment_id, expira_en)
Entrada      (id, orden_id, lote_id, titular, dni, codigo, es_cortesia, estado, usada_en, usada_por)
Usuario      (id, nombre, email, rol: admin | validador)
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
