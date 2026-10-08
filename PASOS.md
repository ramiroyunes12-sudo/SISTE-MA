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
- [ ] **13. Código de cada entrada** — token aleatorio firmado (HMAC).
  - Notas: código al azar de 128 bits (`crypto.randomBytes`) + firma HMAC-SHA256 con una clave propia (no `CLAVE_CIFRADO`), con prefijo de versión para poder cambiar la clave. Verificar la firma con `timingSafeEqual` antes de tocar la base. En la base, solo la huella del código (índice único; si choca, reintentar).
- [ ] **14. QR y PDF**
  - Notas: QR y PDF se generan en nuestro servidor (sin APIs externas: llevan nombre y DNI). El QR lleva solo el código firmado. No guardar los PDF: se rearman desde la base.
- [ ] **15. Enviar el mail** — Gmail SMTP.
  - Con varias productoras, el límite de Gmail (~500 por día) puede quedar corto: evaluar Resend con dominio propio.
  - Notas: en Vercel no sirven las colas en memoria: marcar en la base qué mail falta (en la misma transacción que confirma el pago) y mandarlo después con `after()`; reintentar los pendientes. En Gmail el QR va como adjunto (CID) o en el PDF, no como imagen `data:`.
- [ ] **16. "Compra confirmada" y "Reenviar mis entradas"**
  - Notas: "Reenviar" por POST (nunca email o DNI en la URL), con límite, y la misma respuesta exista o no el email.

## Bloque 5 — Puerta
- [ ] **17. Escáner** — cámara del celu, marcar usada de forma atómica.
  - Incluye la pantalla "Validadores" para que cada organizador maneje los suyos (hoy los suma el ADMIN desde Productoras).
  - Notas: marcar usada con un solo UPDATE condicionado (`estado = VALIDA`) y mirar `count`; si da 0, decir "ya usada a las HH:MM". Ante cualquier error: NO VÁLIDA. Cámara: HTTPS, `facingMode: environment`, en iPhone `playsinline` + `muted`; Safari no tiene BarcodeDetector (hace falta una librería). Resultado con color + texto grande, usable con una mano y de noche. Se puede probar sin celular con la cámara falsa de Chromium.
- [ ] **18. Búsqueda por DNI y contador**

## Bloque 6 — Admin completo
- [ ] **19. Cortesías** — individual, carga masiva, cupo aparte.
- [ ] **20. Ventas, resumen, exportar y reembolsos**
  - Cada organizador ve las estadísticas de sus eventos; el ADMIN, de todos (y por productora).

## Bloque 7 — Salir a producción
- [ ] **21. Publicarlo en internet** — Vercel + claves reales + compra de prueba real.
  - Lista antes de vender: Access Token de producción en cada productora; `CLAVE_CIFRADO` y la clave de los códigos guardadas aparte (si se pierden, hay que reconectar cuentas y reemitir entradas); borrar el evento y las compras de prueba; plan de Supabase (el gratis se pausa sin uso; backups según plan); límites de Vercel Hobby; límite de conexiones a la base (`max` del pool); consultar al contador (cargo por Mercado Pago, facturación).
