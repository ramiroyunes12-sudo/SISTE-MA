-- Paso 15: el mail con las entradas.
--
-- ordenes.mail_intento_en: cuándo empezó el último intento de mandarlo. Cada
-- envío "toma" la orden con un UPDATE condicionado sobre esta columna, así
-- dos envíos a la vez no mandan el mismo mail dos veces
-- (src/lib/mails/pendientes.ts).
--
-- Las compras que ya estaban pagas (todas de prueba) no se mandan solas: sin
-- esto, el primer envío les mandaría el mail a todas juntas. Quedan en el
-- panel (Evento → Pagos) como mails que no salieron, con el botón para
-- mandarlos igual. 5 = MAX_INTENTOS de src/lib/mails/pendientes.ts.
LOCK TABLE "entradas"."ordenes" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "entradas"."ordenes" ADD COLUMN "mail_intento_en" TIMESTAMPTZ(3);

UPDATE "entradas"."ordenes"
SET "mail_intentos" = 5, "mail_error" = 'Se pagó antes de que existieran los mails: no se mandó solo.'
WHERE "estado" = 'PAGADA' AND "mail_enviado_en" IS NULL;

-- productoras.email_contacto: a dónde llegan las respuestas al mail con las
-- entradas (Reply-To). Vacío: a la cuenta de mail de la plataforma.
ALTER TABLE "entradas"."productoras" ADD COLUMN "email_contacto" TEXT;
