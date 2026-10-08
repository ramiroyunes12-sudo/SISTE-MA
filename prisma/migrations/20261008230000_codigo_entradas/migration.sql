-- Paso 13: el código de cada entrada son 128 bits al azar en hexadecimal con
-- mayúsculas (src/lib/entradas/codigo.ts). La firma del QR no se guarda: se
-- calcula con la clave del servidor.
--
-- Las entradas que ya existían (todas de prueba y sin QR emitido) reciben un
-- código nuevo con el formato.
UPDATE "entradas"."entradas"
SET "codigo" = upper(substr(encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'), 1, 32))
WHERE "codigo" !~ '^[0-9A-F]{32}$';

ALTER TABLE "entradas"."entradas"
  ADD CONSTRAINT "entradas_codigo_formato" CHECK ("codigo" ~ '^[0-9A-F]{32}$');
