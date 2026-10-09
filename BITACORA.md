# Bitácora

Una entrada por chat, la más nueva arriba. Corta: qué se hizo, qué quedó y cómo se probó. El detalle está en los commits y en `PASOS.md`.

## 9/10/2026 — Paso 14: QR y PDF
- QR por entrada en el link de la compra y PDF A6 (todas o una), armados en nuestro servidor con `qrcode` y `pdf-lib`, sin guardar nada.
- Ramiro probó el borrador en producción: QR en la compra N° 2, VÁLIDA, PDF descargado y escaneado.
- Revisión con 4 agentes: nada grave; arreglos en el mismo chat.
- Segunda revisión ("¿está listo?", 9 agentes con verificación): nada roto ni inseguro; arreglados nombre largo en el PDF, aviso de no compartir el link, nombres imprimibles, emojis, test de la ruta. 241 tests (0 salteados) y build.
- Ramiro probó los arreglos en producción: "anda todo bien" → paso 14 `[x]`.

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
