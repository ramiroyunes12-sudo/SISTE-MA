# Pasos

Cada paso termina con algo para probar. Se marca `[x]` cuando está revisado.

## Bloque 0 — Preparar el terreno
- [x] **1. Crear el proyecto vacío** — Next.js + TypeScript + Tailwind, página de bienvenida.
- [x] **2. Conectar la base de datos** — PostgreSQL en Supabase + Prisma. https://siste-ma.vercel.app/api/salud → conectada.
  - Ojo: instalar Prisma 7 con versión explícita (`prisma@7`, `@prisma/client@7`). Hoy el `latest` de `prisma` es una 8.0 RC sin `generate` ni `migrate`.
  - El sistema usa el usuario `entradas_app` (sin permisos de administrador). Todavía no puede crear tablas: en el paso 3 hay que darle permiso sobre su esquema.
- [ ] **3. Definir las tablas** — Evento, TipoEntrada, Lote, Orden, Entrada, Usuario, Escaneo.
  - Ojo: las tablas en `public` quedan expuestas por la API de Supabase; activar RLS o usar otro esquema.
- [ ] **4. Datos de prueba** — seed con un evento de ejemplo.

## Bloque 1 — Admin: login y evento
- [ ] **5. Login del administrador** — roles admin y validador.
- [ ] **6. Pantalla "Evento y lotes"** — crear/editar evento, tipos y lotes.

## Bloque 2 — Página pública
- [ ] **7. Página del evento** — flyer, datos y lotes con su estado.
- [ ] **8. Lógica de lotes** — paso automático de lote sin vender de más (con tests).
- [ ] **9. Formulario de datos (checkout)** — nombre y DNI por entrada.
- [ ] **10. Reserva temporal** — 10 minutos para pagar.

## Bloque 3 — Cobrar con Mercado Pago
- [ ] **11. Conectar Mercado Pago (modo prueba)** — Checkout Pro.
- [ ] **12. Confirmar el pago (webhook)** — sin entradas dobles.

## Bloque 4 — Entrada, QR y mail
- [ ] **13. Código de cada entrada** — token aleatorio firmado (HMAC).
- [ ] **14. QR y PDF**
- [ ] **15. Enviar el mail** — Gmail SMTP.
- [ ] **16. "Compra confirmada" y "Reenviar mis entradas"**

## Bloque 5 — Puerta
- [ ] **17. Escáner** — cámara del celu, marcar usada de forma atómica.
- [ ] **18. Búsqueda por DNI y contador**

## Bloque 6 — Admin completo
- [ ] **19. Cortesías** — individual, carga masiva, cupo aparte.
- [ ] **20. Ventas, resumen, exportar y reembolsos**

## Bloque 7 — Salir a producción
- [ ] **21. Publicarlo en internet** — Vercel + claves reales + compra de prueba real.
