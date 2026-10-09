# Pendientes

Lo que **no** está atado a un paso de `PASOS.md`: acciones manuales del dueño y temas sueltos. Lo que sí es de un paso va en las notas de ese paso (no repetirlo acá). Cuando algo se resuelve, se borra de acá y, si vale la pena, se anota en `BITACORA.md`.

## Acciones del dueño (a mano)

| Qué | Por qué | Desde |
|---|---|---|
| Cargar `CLAVE_CODIGOS` en Vercel (panel → Claves → Vercel → Settings → Environment Variables, Production) y redeployar | Sin ella no se firman ni leen los códigos de las entradas. Guardarla también aparte: si se pierde, ningún QR emitido sirve | Paso 13 |
| Cambiar `CLAVE_CIFRADO` por una nueva del panel → Claves, redeployar y reconectar la cuenta de Mercado Pago | La actual quedó escrita en un chat | Paso 13 |
| Probar el paso 13 en producción y avisar | Para marcarlo `[x]` | Paso 13 |
| Borrar `MERCADOPAGO_ACCESS_TOKEN` de Vercel (opcional) | Ya no se usa: el token va cifrado en la base | Paso 11 |

## Temas sin paso asignado

| Qué | Notas |
|---|---|
| Subir imágenes del flyer | Hoy hay espacios marcados para historia (9:16) y publicación (4:5). Decidir dónde se guardan (por ejemplo Supabase Storage) y en qué paso entra. |
| Conectar Mercado Pago con un botón (OAuth) | Hoy el ADMIN pega el Access Token de cada productora. |
| Plan B de transferencias | Que quien compra pegue el código del comprobante ("ID COELSA" = `e2e_id` en Mercado Pago). Probar antes con 2-3 apps de bancos. |
| Limitar intentos de login por IP | Opcional, con el firewall de Vercel (hoy hay bloqueo por cuenta). |
| Índices para 6 claves foráneas | Los sugiere Supabase (entradas.lote/orden/tipo, validada_por, escaneos.usuario, ordenes.emitida_por). Sumarlos en una migración cuando haya datos. |
