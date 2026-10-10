# Bitácora

Una entrada por chat, la más nueva arriba. Corta: qué se hizo, qué quedó y cómo se probó. El detalle está en los commits y en `PASOS.md`.

## 10/10/2026 — Paso 17: escáner de la puerta (borrador, probado)
- Decidido con Ramiro: escanear = entra (la entrada queda usada al leerla; se ven nombre, DNI y tipo, y un botón para la siguiente).
- Borrador: `src/lib/entradas/escanear.ts` (un solo `UPDATE` condicionado + registro en `escaneos`), `POST /api/puerta/escanear` (ruta y no acción, para cortar a los 8 s sin trabar los siguientes), `/validar` (eventos de la productora) y `/validar/<evento>` (cámara con BarcodeDetector o jsQR, verde/rojo en pantalla completa, sonido, vibración, linterna, código a mano), panel "Validadores" del organizador (`soloRol` en `productoras.ts`).
- Probado en local con la cámara falsa de Chromium (camino de iPhone). 322 tests (0 salteados), typecheck, lint y build.
- Prueba de Ramiro en producción (PR #11): anduvo todo en compu, celu y el Android de un amigo; un validador nuevo entró, escaneó, quedó afuera al desactivarlo y volvió al activarlo. Pedido por él: "Validadores" también para el ADMIN (una sección por productora). 325 tests (0 salteados).
- Quedó: la revisión con agentes. El paso 16 sigue esperando su prueba.

## 9-10/10/2026 — Paso 16: "Compra confirmada" y "Reenviar mis entradas"
- Decidido con Ramiro: reenviar desde cada evento (email + DNI); link propio por entrada, más adelante. Después de probar el borrador: la menor cantidad de mails (las compras de una persona en un evento, juntas en un mail).
- Borrador (PR #9): `src/lib/mails/reenviar.ts` (reenviar = dejar la orden "falta el mail" con un `UPDATE` condicionado), "Compra confirmada" como el diseño, `/e/<evento>/mis-entradas`.
- Prueba de Ramiro: salieron las 4 compras pero Gmail las escondió en la conversación de cada una → el reenvío lleva otro asunto y las compras de la persona van en un solo mail (`pendientes.ts` las toma y reintenta juntas).
- Revisión con 4 agentes (seguridad, carreras del reenvío, carreras de las compras juntas, pantallas): email gigante que trababa el servidor, formularios que sin JavaScript mandaban datos por la URL, pedidos que contaban doble, "ya sale" sin estar saliendo, intento colgado que pisaba un reenvío, traba entre consultas, mail que podía salir dos veces si se caía la base, página que quedaba abajo de todo al confirmarse el pago, mensajes fuera de la pantalla. Todo arreglado con su test. 305 tests (0 salteados) y build.
- Quedó: la prueba de Ramiro de los arreglos.

## 9/10/2026 — Paso 15: el mail con las entradas (probado)
- Paso 14 marcado `[x]` (Ramiro probó los arreglos).
- Decidido con Ramiro: Gmail (contraseña de aplicación), remitente la productora, PDF con todas + uno por persona, tipo y lote en la entrada. Después: el mail no recibe respuestas; para problemas, su WhatsApp (`WHATSAPP_AYUDA`) en el mail, el PDF y la página (se sacó el "mail de contacto" de la productora).
- Borrador: `src/lib/mails/` (SMTP con `nodemailer`, contenido como el diseño, envío una sola vez con `UPDATE` condicionado y reintentos), `after()` donde se confirma un pago, panel "Mails con las entradas". Migración `20261009120000_mails`.
- Revisión con 3 agentes (seguridad, envío único, cómo se ve): nada grave; arreglados mails que nadie pedía o quedaban sin intentar, hora vieja al tomar (mail doble), reintentos espaciados y límite de Gmail, tarea diaria de Vercel (`CRON_SECRET`), lote en el PDF, Outlook, asunto con N° de compra, textos. 277 tests (0 salteados) y build.
- Prueba en producción: primero Gmail rechazó el ingreso (variables cruzadas, clave vieja y botones de una versión anterior después de cada Redeploy); el panel ahora muestra el código de Gmail. Con la clave nueva salieron los 4 mails (cayeron en spam, cuenta nueva). Ramiro probó QR, PDF y WhatsApp: paso 15 `[x]`.
- Decidido: seguir con Gmail, sin pagar Resend.

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
