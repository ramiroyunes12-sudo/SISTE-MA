# Pasos

Cada paso termina con algo para probar. Se marca `[x]` cuando está revisado.

## Bloque 0 — Preparar el terreno
- [x] **1. Crear el proyecto vacío** — Next.js + TypeScript + Tailwind, página de bienvenida.
- [x] **2. Conectar la base de datos** — PostgreSQL en Supabase + Prisma. https://siste-ma.vercel.app/api/salud → conectada.
  - Ojo: instalar Prisma 7 con versión explícita (`prisma@7`, `@prisma/client@7`). Hoy el `latest` de `prisma` es una 8.0 RC sin `generate` ni `migrate`.
  - El sistema usa el usuario `entradas_app` (sin permisos de administrador).
- [x] **3. Definir las tablas** — usuarios, eventos, tipos_entrada, lotes, ordenes, pagos, entradas, escaneos.
  - Esquema `entradas` (no `public`): la API de Supabase no lo publica. Migraciones automáticas en el deploy de producción.
  - Pendiente (menor): Supabase sugiere índices para 6 claves foráneas (entradas.lote/orden/tipo, validada_por, escaneos.usuario, ordenes.emitida_por). Sumarlos en una migración cuando haya datos.
  - Para el paso 9: ¿una misma persona (DNI) puede tener dos entradas del mismo evento? Hoy la base lo permite.
- [x] **4. Datos de prueba** — `npx prisma db seed`: "Evento de prueba" (sáb 21/11/2026 23:00) con General (Lotes 1–3) y VIP. Cargado en Supabase.
  - Borrar el evento de prueba antes del paso 21 (salir a vender).
  - El usuario admin se crea en el paso 5, junto con el login.

## Bloque 1 — Admin: login y evento
- [x] **5. Login del administrador** — roles admin y validador. Entrar por `/ingresar`: el admin va a `/admin`, el validador a `/validar`.
  - Usuarios nuevos o contraseña olvidada: `npm run usuario` (da una contraseña temporal que vence en 72 h y se cambia al entrar; con `--sql` imprime el SQL para Supabase).
  - Revisado por 5 revisores + verificadores: se arreglaron 30 hallazgos (contraseñas comunes, carreras al cambiar la contraseña, mensajes que delataban emails, errores en español, vencimiento de la temporal).
  - Para más adelante (opcional): además del bloqueo por cuenta, limitar intentos por IP con el firewall de Vercel.
- [x] **6. Pantalla "Evento y lotes"** — crear/editar evento, tipos y lotes. Panel → "Evento y lotes" (`/admin/eventos`).
  - Precios en pesos ("8.000"), fecha en hora argentina. No deja bajar un cupo por debajo de lo vendido ni quitar lotes o tipos con entradas.
  - El flyer se sube más adelante (por ahora, el espacio marcado).
- [x] **6b. Productoras** — varias productoras usan la plataforma; cada una ve solo lo suyo.
  - Roles: ADMIN (vos: todo), ORGANIZADOR (sus eventos y números), VALIDADOR (solo la puerta). Panel → "Productoras" (solo ADMIN): crear productora con su organizador, sumar gente, contraseña temporal nueva, desactivar.
  - Cobros: cada productora con su propio Mercado Pago (pasos 11-12); vos cobrás un alquiler fijo por evento, aparte.
  - Flyer: espacios marcados para historia (9:16) y publicación (4:5) con su botón; subir imágenes, más adelante.
  - Revisado con 2 agentes (aislamiento entre productoras).

## Bloque 2 — Página pública
- [x] **7. Página del evento** — flyer, datos y el lote en venta de cada tipo. `/e/<dirección>` (ej.: `/e/evento-de-prueba`); desde el panel, "Ver página ↗".
  - Flyer: por ahora el espacio marcado (las imágenes se suben más adelante).
  - El público ve SOLO el lote en venta (nombre y precio). Nada de cantidades vendidas ni disponibles, y los lotes siguientes no se muestran (ni se mandan al navegador) hasta que se agote el anterior. Si no queda nada: "Agotado".
  - Elegir cantidades con + y − (hasta el máximo por compra) y ver el total. "Continuar" queda deshabilitado hasta la compra (pasos 9-12).
  - Borradores: vista previa solo para el ADMIN y la gente de esa productora; para el resto, 404.
- [x] **8. Lógica de lotes** — paso automático de lote sin vender de más (con tests). Para probarlo: panel → evento → "Probar una compra".
  - Decidido (1a): si alguien pide 4 y en el lote quedan 2, van 2 de ese lote y 2 del siguiente, cada una a su precio.
  - Decidido (2a): las reservas sin pagar ocupan lugar; si vencen, el lote anterior (más barato) vuelve a estar en venta.
  - Compras y ediciones de un mismo evento pasan de a una, en fila ("turno del evento"): nunca se vende de más ni se traba, y editar en plena venta no queda esperando para siempre.
  - Revisado con 19 agentes: 8 hallazgos confirmados y arreglados (un editor duplicado en pantalla al guardar, editar trabado durante una ola de compras, y tests que no probaban lo que decían).
- [x] **9. Formulario de datos (checkout)** — nombre y DNI por entrada. En la página del evento, elegir entradas → "Continuar" (`/e/<dirección>/datos`).
  - Un bloque por entrada ("Entrada 1 · General", "Entrada 2 · VIP"…) con nombre y apellido y DNI de quien la usa; abajo, email (dos veces) y celular (opcional).
  - Decidido: no hay límite por DNI (un mismo DNI puede tener varias entradas).
  - El resumen muestra el reparto real por lote (si el pedido cruza de lote, lo explica). Todavía no reserva ni cobra: al tocar "Continuar al pago" se revisan los datos y listo.
- [x] **10. Reserva temporal** — 10 minutos para pagar. Elegir entradas → "Continuar" → `/compra/<llave>`.
  - "Continuar" crea la orden PENDIENTE con una entrada por persona y aparta los lugares, todo en la misma transacción. El link de la compra es secreto (solo se guarda su huella) y aguanta recargar la página.
  - Reloj de 10 minutos (con la hora del servidor). Los datos de cada entrada se guardan en la orden y se pueden corregir hasta pagar. "Cambiar entradas" cancela y devuelve los lugares.
  - Vencidas: se liberan al reservar en el evento (dentro de su turno), al abrir la página del evento, la de la compra o el panel (sin hacer fila si el turno está ocupado). Cada orden se cierra una sola vez (cambio de estado condicionado).
  - Límite: 3 reservas abiertas por navegador y 15 por conexión (muchos celulares comparten la IP de la compañía). Si el mismo navegador vuelve a elegir en el mismo evento, la reserva anterior se cancela.
  - Para más adelante (paso 21): una tarea programada que libere vencidas aunque nadie entre (hoy alcanza con lo de arriba).

## Bloque 3 — Cobrar
- [x] **11 y 12. Cobrar: transferencia o Mercado Pago, y confirmar sin entradas dobles.** En la compra, con los datos completos: "Pagar por transferencia" o "Pagar con Mercado Pago".
  - Probado antes con plata real: una transferencia al alias entra sin comisión y aparece en la API de Mercado Pago con el monto exacto (sin datos de quien la mandó). Un cobro con Checkout Pro de $100 descontó $4,21 (4,21%) y la plata quedó a 18 días.
  - Decidido (C): quien compra elige. Transferencia sin recargo, con monto único (centavos) para saber de quién es; Mercado Pago con cargo por servicio (4,4%, se cambia en el panel).
  - Reserva de 15 minutos (antes 10): da tiempo a transferir.
  - Se confirma solo: mirando los movimientos de la cuenta mientras quien compra espera, con el aviso de Mercado Pago y al volver del cobro. Cada orden se confirma una vez (UPDATE condicionado con el turno del evento) y cada pago se registra una vez.
  - Pago tarde: si queda lugar en esos lotes, se confirma; si no, "para devolver". Pago repetido: "para devolver". Casos raros (sin los centavos): "Confirmar pago" a mano en el panel del evento.
  - Por ahora la cuenta de Mercado Pago la conecta el ADMIN pegando el Access Token (cifrado en la base). Una cuenta, una sola productora. Sin cuenta conectada no se ofrece ningún pago. Para más adelante: que cada productora la conecte con un botón (OAuth).
  - Revisado con 8 agentes: 34 hallazgos, arreglados (entre otros: una cuenta en dos productoras podía confirmar la compra de otra persona, transferencia ofrecida sin poder detectarla, "Cambiar entradas" después de pagar, volver de Mercado Pago con el pago rechazado, montos que se podían agotar, contracargos que seguían sumando).
  - Para más adelante: devolver la plata desde el panel y anular entradas de pagos revertidos (paso 20), avisar por mail (paso 15).
  - Probado en producción con plata real (8/10/2026): compra N° 1 por transferencia ($100,01, sin comisión) y N° 2 con Mercado Pago ($105 = $100 + $5 de cargo; Mercado Pago descontó $4,42 y quedaron $100,58). Las dos se confirmaron solas, sin errores; lote y entradas cuadran.
  - Decidido (8/10): la transferencia sigue con centavos únicos. Investigado y descartado por ahora: monto exacto sin centavos (con 5 compras en 15 minutos, 1 de cada 4 queda en duda), QR por compra (no se escanea desde el mismo celular), CVU por compra (Talo/Cucuru: comisión y monotributo). Plan B para más adelante: que el comprador pegue el código del comprobante ("ID COELSA" = `e2e_id` en Mercado Pago), probándolo antes con 2-3 apps.

## Bloque 4 — Entrada, QR y mail
- [x] **13. Código de cada entrada** — token aleatorio firmado (HMAC). Para probarlo: en una compra paga aparece el código de cada entrada; en el panel del evento, "Verificar una entrada".
  - Formato `E1-<128 bits al azar>-<firma>` en hexadecimal con mayúsculas (QR más chico). La firma es HMAC-SHA256 con su propia clave, `CLAVE_CODIGOS` (no la de los tokens de Mercado Pago); `E1` es la versión de la clave, para poder cambiarla.
  - En la base va solo la parte al azar (con índice único y un control de formato). Con la base sola no se arma un QR válido (falta la clave); con la clave sola tampoco (no se conoce ninguna entrada). La firma se revisa con `timingSafeEqual` antes de buscar en la base.
  - "Verificar una entrada" solo mira (no marca usada): VÁLIDA, YA USADA (con la hora), SIN PAGAR, ANULADA o NO VÁLIDA (código trucho, inexistente o de otro evento, sin mostrar datos).
  - Las entradas que ya existían recibieron un código nuevo (eran de prueba, sin QR emitido).
  - Revisado con 4 agentes: nada grave. Arreglado: clave propia (`CLAVE_CODIGOS`), la verificación filtra por productora adentro de la función (con test), test con la firma exacta (si alguien cambia cómo se firma, falla), si cambia `CLAVE_CIFRADO` la cuenta de Mercado Pago queda "a reconectar" en vez de romper la página, el resultado de "Verificar" se esconde al cambiar el código.
  - Seguridad: `CLAVE_CIFRADO` se había creado desde el chat (su valor quedó en la conversación): se cambió por una nueva generada en el panel (Claves), sin pasar por el chat (9/10).
  - Probado en producción (9/10/2026): el código de una entrada de la compra N° 2 dio VÁLIDA con titular, DNI y compra correctos.
  - Para el paso 20: hoy el panel no lista las compras pagas ni sus entradas (solo cuántas y lo cobrado); el código se ve solo en el link de la compra. La página de prueba que mostraba los movimientos de Mercado Pago (`/admin/mercadopago-prueba`) se sacó en el paso 11.
- [x] **14. QR y PDF** — probado por Ramiro en producción (9/10/2026: el borrador, QR en el link de la compra N° 2, VÁLIDA, PDF descargado y escaneado; después, los arreglos de las dos revisiones). Para probarlo: abrir el link de una compra paga: arriba el aviso "No compartas este link"; cada entrada muestra su QR y su código; "Descargar … (PDF)" abre el PDF (una página por entrada) y desde ahí se guarda o comparte; con 2 o más entradas, "Descargar solo esta (PDF)" abre una sola. Escanear un QR (de la pantalla o del PDF) muestra el código `E1-…`; pegado en panel → evento → "Verificar una entrada" da VÁLIDA. Probar también abrir el link desde Instagram o WhatsApp en un Android y tocar "Descargar".
  - Notas: QR y PDF se generan en nuestro servidor (sin APIs externas: llevan nombre y DNI). El QR lleva solo el código firmado. No guardar los PDF: se rearman desde la base.
  - Decidido (9/10): un PDF con todas las entradas y, además, cada una suelta (para pasársela a quien va). En la entrada (pantalla y PDF) van nombre y DNI completo.
  - Librerías: `qrcode` (arma la matriz del QR) y `pdf-lib` (el PDF), las dos corren en nuestro servidor. El QR sale en modo alfanumérico, versión 4 (33×33), corrección M; en pantalla es un SVG negro sobre blanco (la página es siempre clara: `color-scheme: only light`, así el modo oscuro forzado no invierte el QR) y en el PDF va dibujado con rectángulos (vectorial). PDF tamaño A6, fuentes estándar (`src/lib/entradas/texto-pdf.ts`: letras fuera de Europa occidental pasan a sin acento o "?"; emojis e invisibles se sacan; nunca rompen el PDF). El nombre va completo (hasta 2 renglones). Una entrada usada dice "YA USADA" en el PDF.
  - Ruta `/compra/<llave>/pdf` (y `?entrada=N`, el número de la entrada en la compra, contando las anuladas igual que la página): la llave del link es el permiso, como la página de la compra (no usa `requerirUsuario()`). Solo compras PAGADAS y entradas válidas o usadas (las anuladas no). Se abre en el visor (`inline`): en iPhone se ve y se comparte; en Android, Chrome lo descarga; en el navegador de Instagram/WhatsApp en Android no está probado. Sin `CLAVE_CODIGOS` responde "no disponible" (503). Sin caché (`private, no-store`), `nosniff`.
  - El link de la compra (y el de "Descargar solo esta") abre **toda** la compra: la página avisa "No compartas este link: con él cualquiera ve y puede usar tus entradas… mandale el archivo PDF". Un link propio por entrada queda para el paso 16.
  - Nombres de las entradas: solo letras latinas que se puedan imprimir, como en el DNI (cirílico, Ł, ẞ o letras de ancho completo no; ř sale r). Las tildes en dos partes (texto copiado de una Mac) se juntan y los apóstrofos ´ ‘ ` ʼ pasan a ’.
  - Revisado con 4 agentes (seguridad, PDF, página en el celu, tests y reglas): nada grave. Arreglado: texto de la compra paga que decía "te llegan por mail", descarga `inline` sin `download`, "YA USADA" en el PDF, texto de entrada anulada, botón que no se corta a 320 px, `color-scheme`, caracteres invisibles y mayúsculas en el PDF, nombres solo latinos, `pdf-lib` fuera de la página (`descarga.ts` aparte).
  - Segunda revisión ("¿está listo?", 9 agentes, cada hallazgo verificado por otro): nada roto ni inseguro. Arreglado: el PDF cortaba con "…" los nombres largos; aviso de no compartir el link; emojis del evento salían "??"; nombres que salían con "?" o se rechazaban de más (tildes en dos partes, apóstrofos); test de los encabezados de la ruta (sin caché, inline, 404, 503).
  - Quedan textos que prometen el mail antes de pagar ("¿A dónde te mandamos las entradas?", "Todas las entradas llegan a este email…", "Las entradas llegan a…"): los hace ciertos el paso 15.
  - Para el paso 20: decidir si se puede bajar el PDF de un evento ya terminado (hoy sí). Para el paso 21: límite de pedidos por minuto a la ruta del PDF (hoy hace falta la llave y el PDF es chico).
- [ ] **15. Enviar el mail** — borrador listo (9/10/2026); falta la revisión con agentes y que Ramiro lo pruebe. **Antes**, cargar Gmail en Vercel (ver `PENDIENTES.md`). Para probarlo: comprar en https://siste-ma.vercel.app/e/evento-de-prueba con tu email y pagar; tiene que llegar "Tus entradas para …" de parte de la productora, con el QR de cada entrada (nombre, DNI, "General · Lote N", código) y adjuntos el PDF con todas y, con 2 o más, uno por persona. Escanear un QR del mail → panel → "Verificar una entrada" da VÁLIDA. El link de la compra paga dice "Te mandamos las entradas a …". Panel → evento → Pagos → "Mails con las entradas": cuántos salieron y cuáles no (motivo y "Reintentar ahora"); las compras que ya estaban pagas figuran como que no salieron, y con "Reintentar ahora" salen. Responder el mail: llega al "Mail de contacto" de la productora (Productoras → Datos).
  - Decidido (9/10): Gmail con contraseña de aplicación (gratis, ~500 por día); el código es SMTP común, así que pasar a Resend u otro es cambiar las variables (y `MAIL_DESDE`). Remitente: el nombre de la productora; respuestas a su "Mail de contacto" (si está vacío, a la cuenta de Gmail). Adjuntos: el PDF con todas y, con 2 o más, uno por persona. Tipo y lote ("General · Lote 2") en el mail, el PDF y la página. El mail no lleva el link de la compra (no se guarda la llave).
  - Cómo funciona (`src/lib/mails/`): falta el mail mientras la orden está PAGADA sin `mail_enviado_en` (no hace falta marcar nada en la transacción del pago). Después de responder, con `after()`, piden mandar los que faltan el aviso de Mercado Pago, la pantalla que espera el pago, "Confirmar pago" y "Buscar pagos ahora" del panel, el link de la compra paga y el panel del evento. Cada envío toma la orden con un `UPDATE` condicionado (`mail_intento_en`, columna nueva): aunque se pida tres veces a la vez sale una sola vez (test que falla sin la condición). Si falla: motivo sin datos de la persona (el servidor puede repetir el email: no se guarda), reintento a los 5 minutos, hasta 5; después solo "Reintentar ahora". Sin `SMTP_*` o sin `CLAVE_CODIGOS` no gasta intentos. La compra se carga por id de orden (`buscarCompraPorId`); el QR del mail es un PNG adjunto (cid) armado en nuestro servidor (`qrPng`). La migración marca las compras que ya estaban pagas para que no se manden solas.
  - Mail de contacto de la productora: Productoras → Datos (solo ADMIN), columna nueva `email_contacto`.
  - Para el paso 16: `mailDeOrden` arma el mail de una orden: "Reenviar mis entradas" lo puede usar (con su límite). Para el paso 19: hoy solo se mandan mails de ventas (`buscarCompraPorId` y los pendientes filtran `VENTA`): sumar las cortesías. Para el paso 20: un mail ya enviado no se puede deshacer (si se reembolsa, sus QR se anulan en la base). Para el paso 21: sin tarea programada, un mail que falló se reintenta cuando pasa algo (otra compra, abrir el link o el panel); si hace falta, una tarea diaria de Vercel. Con varias productoras o eventos grandes, el límite de Gmail (~500 por día, y Google frena si se mandan muchos seguidos) queda corto: pasar a Resend con dominio propio.
- [ ] **16. "Compra confirmada" y "Reenviar mis entradas"**
  - Notas: "Reenviar" por POST (nunca email o DNI en la URL), con límite, y la misma respuesta exista o no el email.
  - Del paso 14: un link propio por entrada (firmado), para pasarle su entrada a alguien sin darle el link de toda la compra. Preguntarle a Ramiro si la entrada muestra el lote (el diseño dice "General · Lote 2"; hoy solo el tipo). "Reenviar" también necesita cargar la compra por id de orden (ver paso 15).

## Bloque 5 — Puerta
- [ ] **17. Escáner** — cámara del celu, marcar usada de forma atómica.
  - Incluye la pantalla "Validadores" para que cada organizador maneje los suyos (hoy los suma el ADMIN desde Productoras).
  - Notas: marcar usada con un solo UPDATE condicionado (`estado = VALIDA`) y mirar `count`; si da 0, decir "ya usada a las HH:MM". Ante cualquier error: NO VÁLIDA. Cámara: HTTPS, `facingMode: environment`, en iPhone `playsinline` + `muted`; Safari no tiene BarcodeDetector (hace falta una librería). Resultado con color + texto grande, usable con una mano y de noche. Se puede probar sin celular con la cámara falsa de Chromium.
- [ ] **18. Búsqueda por DNI y contador**

## Bloque 6 — Admin completo
- [ ] **19. Cortesías** — individual, carga masiva, cupo aparte.
  - Del paso 14: una cortesía no tiene link de compra y `buscarCompra` solo devuelve ventas: para su QR y PDF, cargar por id de orden (como el mail del paso 15). En el PDF, "Cortesía" en vez de "Compra N°".
- [ ] **20. Ventas, resumen, exportar y reembolsos**
  - Cada organizador ve las estadísticas de sus eventos; el ADMIN, de todos (y por productora).
  - Del paso 14: ver o descargar el PDF de una compra desde el panel (por id, con `requerirUsuario()` y `alcance.ts`) para ayudar a quien perdió el link. El link de una compra REEMBOLSADA hoy diría "Se venció tu reserva": darle su propio texto. Decidir si se baja el PDF de un evento terminado.

## Bloque 7 — Salir a producción
- [ ] **21. Publicarlo en internet** — Vercel + claves reales + compra de prueba real.
  - Lista antes de vender: Access Token de producción en cada productora; `CLAVE_CIFRADO` y `CLAVE_CODIGOS` guardadas aparte (si se pierden, hay que reconectar cuentas y reemitir entradas); borrar el evento y las compras de prueba; plan de Supabase (el gratis se pausa sin uso; backups según plan); límites de Vercel Hobby; límite de conexiones a la base (`max` del pool); consultar al contador (cargo por Mercado Pago, facturación).
