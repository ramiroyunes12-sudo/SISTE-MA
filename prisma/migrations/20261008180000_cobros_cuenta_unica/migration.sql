-- Paso 11 (arreglo de la revisión): una cuenta de Mercado Pago puede estar
-- conectada a una sola productora. Si dos compartieran cuenta, una
-- transferencia de una podía confirmar una compra de la otra (los montos
-- únicos son por productora).

-- Si ya hay una cuenta en dos productoras, queda en la que la conectó
-- primero; a las demás se les desconecta (hay que volver a conectarlas).
UPDATE "entradas"."productoras" p
SET "mp_usuario_id" = NULL, "mp_cuenta" = NULL, "mp_token_cifrado" = NULL, "mp_conectada_en" = NULL
WHERE "mp_usuario_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "entradas"."productoras" otra
    WHERE otra."mp_usuario_id" = p."mp_usuario_id"
      AND (COALESCE(otra."mp_conectada_en", otra."creada_en"), otra."id") < (COALESCE(p."mp_conectada_en", p."creada_en"), p."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "productoras_mp_usuario_id_key" ON "entradas"."productoras"("mp_usuario_id");

-- Hasta cuándo quedaron revisados los movimientos de la cuenta: la próxima
-- revisión pide solo lo nuevo (con unos minutos de margen).
ALTER TABLE "entradas"."productoras" ADD COLUMN "mp_revisado_hasta" TIMESTAMPTZ(3);
