# Bitácora

Una entrada por chat, la más nueva arriba. Corta: qué se hizo, qué quedó y cómo se probó. El detalle está en los commits y en `PASOS.md`.

## 9/10/2026 — Paso 15: el mail con las entradas
- Paso 14 marcado `[x]` (Ramiro probó los arreglos).
- Decidido con Ramiro: Gmail (contraseña de aplicación), remitente la productora, PDF con todas + uno por persona, tipo y lote en la entrada. Después: el mail no recibe respuestas; para problemas, su WhatsApp (`WHATSAPP_AYUDA`) en el mail, el PDF y la página (se sacó el "mail de contacto" de la productora).
- Borrador: `src/lib/mails/` (SMTP con `nodemailer`, contenido como el diseño, envío una sola vez con `UPDATE` condicionado y reintentos), `after()` donde se confirma un pago, panel "Mails con las entradas". Migración `20261009120000_mails`.
- Revisión con 3 agentes (seguridad, envío único, cómo se ve): nada grave; arreglados mails que nadie pedía o quedaban sin intentar, hora vieja al tomar (mail doble), reintentos espaciados y límite de Gmail, tarea diaria de Vercel (`CRON_SECRET`), lote en el PDF, Outlook, asunto con N° de compra, textos. 277 tests (0 salteados) y build.
- Quedó: cargar Gmail, `WHATSAPP_AYUDA` y `CRON_SECRET` en Vercel y la prueba de Ramiro.

## 9/10/2026 — Paso 14: QR y PDF
- QR por entrada en el link de la compra y PDF A6 (todas o una), armados en nuestro servidor con `qrcode` y `pdf-lib`, sin guardar nada.
- Ramiro probó el borrador en producción: QR en la compra N° 2, VÁLIDA, PDF descargado y escaneado.
- Revisión con 4 agentes: nada grave; arreglos en el mismo chat.
- Segunda revisión ("¿está listo?", 9 agentes con verificación): nada roto ni inseguro; arreglados nombre largo en el PDF, aviso de no compartir el link, nombres imprimibles, emojis, test de la ruta. 241 tests (0 salteados) y build.
- Quedó: la prueba de Ramiro de los arreglos.

## 9/10/2026 — Sistema de contexto entre chats
- Se crearon `CONTEXTO.md` (se carga solo en cada chat), `PENDIENTES.md`, esta bitácora y las skills `empezar-paso` y `cerrar-paso`.
- Ramiro cargó `CLAVE_CODIGOS`, cambió `CLAVE_CIFRADO` y borró `MERCADOPAGO_ACCESS_TOKEN` en Vercel; producción republicada. Ramiro reconectó Mercado Pago.
- Paso 13 probado por Ramiro en producción (VÁLIDA) y marcado `[x]`.
- Sin cambios de código.

## 8-9/10/2026 — Paso 13: código firmado de cada entrada
- Borrador + revisión con 4 agentes + arreglos (clave propia `CLAVE_CODIGOS`, verificación filtrada por productora, panel → Claves).
- Quedó: cargar las claves en Vercel y la prueba del dueño.

## 8/10/2026 — Pasos 11 y 12: cobrar
- Pruebas de la API de Mercado Pago con plata real, después transferencia con centavos únicos o Checkout Pro con cargo. Revisión con 8 agentes (34 hallazgos arreglados).
- Probado en producción con plata real: compras N° 1 (transferencia) y N° 2 (Mercado Pago), confirmadas solas.
- Se sumó la configuración de Claude Code (`.claude/`: permisos, skill `verificar`, reglas).

## 6/10/2026 — Pasos 6b a 10
- Productoras (6b), página pública (7), reparto entre lotes con turno del evento (8, revisión con 19 agentes), datos del checkout (9), reserva temporal (10).

## 4-5/10/2026 — Pasos 1 a 6
- Proyecto Next.js, conexión a Supabase, tablas en el esquema `entradas`, datos de prueba, login con roles (revisión: 30 hallazgos), pantalla "Evento y lotes".
