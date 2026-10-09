# Pendientes

Lo que **no** está atado a un paso de `PASOS.md`: acciones manuales del dueño y temas sueltos. Lo que sí es de un paso va en las notas de ese paso (no repetirlo acá). Cuando algo se resuelve, se borra de acá y, si vale la pena, se anota en `BITACORA.md`.

## Acciones del dueño (a mano)

| Qué | Por qué | Desde |
|---|---|---|
| Reconectar la cuenta de Mercado Pago (panel → Productoras → Cobros) | Se cambió `CLAVE_CIFRADO` (9/10): sin reconectar no se ofrece ningún pago | Paso 13 |

## Temas sin paso asignado

| Qué | Notas |
|---|---|
| Subir imágenes del flyer | Hoy hay espacios marcados para historia (9:16) y publicación (4:5). Decidir dónde se guardan (por ejemplo Supabase Storage) y en qué paso entra. |
| Conectar Mercado Pago con un botón (OAuth) | Hoy el ADMIN pega el Access Token de cada productora. |
| Plan B de transferencias | Que quien compra pegue el código del comprobante ("ID COELSA" = `e2e_id` en Mercado Pago). Probar antes con 2-3 apps de bancos. |
| Limitar intentos de login por IP | Opcional, con el firewall de Vercel (hoy hay bloqueo por cuenta). |
| Índices para 6 claves foráneas | Los sugiere Supabase (entradas.lote/orden/tipo, validada_por, escaneos.usuario, ordenes.emitida_por). Sumarlos en una migración cuando haya datos. |
