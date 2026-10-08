-- Paso 11: cobrar por transferencia (sin recargo) o con Mercado Pago (con
-- cargo por servicio).
-- - La productora guarda su alias, a nombre de quién está, el cargo por
--   servicio y su cuenta de Mercado Pago (el token, cifrado).
-- - La orden guarda cómo eligió pagar y el cargo por servicio cobrado.
-- - montos_transferencia: el monto exacto (con centavos únicos) que ata una
--   transferencia a su orden; no se repite dentro de la misma productora.
-- - pagos: el método, la comisión y si hay que devolverlo.

-- CreateEnum
CREATE TYPE "entradas"."MetodoPago" AS ENUM ('TRANSFERENCIA', 'MERCADOPAGO', 'MANUAL');

-- AlterTable
ALTER TABLE "entradas"."ordenes" ADD COLUMN     "metodo_pago" "entradas"."MetodoPago",
ADD COLUMN     "recargo_centavos" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "entradas"."pagos" ADD COLUMN     "a_devolver" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "comision_centavos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "metodo" "entradas"."MetodoPago" NOT NULL DEFAULT 'MERCADOPAGO',
ADD COLUMN     "nota" TEXT,
ADD COLUMN     "registrado_por_id" UUID;

-- AlterTable
ALTER TABLE "entradas"."productoras" ADD COLUMN     "alias_transferencia" TEXT,
ADD COLUMN     "mp_conectada_en" TIMESTAMPTZ(3),
ADD COLUMN     "mp_cuenta" TEXT,
ADD COLUMN     "mp_revisado_en" TIMESTAMPTZ(3),
ADD COLUMN     "mp_token_cifrado" TEXT,
ADD COLUMN     "mp_usuario_id" TEXT,
ADD COLUMN     "recargo_mp_bps" INTEGER NOT NULL DEFAULT 440,
ADD COLUMN     "titular_transferencia" TEXT;

-- CreateTable
CREATE TABLE "entradas"."montos_transferencia" (
    "orden_id" UUID NOT NULL,
    "productora_id" UUID NOT NULL,
    "monto_centavos" INTEGER NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "montos_transferencia_pkey" PRIMARY KEY ("orden_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "montos_transferencia_productora_id_monto_centavos_key" ON "entradas"."montos_transferencia"("productora_id", "monto_centavos");

-- CreateIndex
CREATE INDEX "pagos_a_devolver_idx" ON "entradas"."pagos"("a_devolver");

-- AddForeignKey
ALTER TABLE "entradas"."montos_transferencia" ADD CONSTRAINT "montos_transferencia_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "entradas"."ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."montos_transferencia" ADD CONSTRAINT "montos_transferencia_productora_id_fkey" FOREIGN KEY ("productora_id") REFERENCES "entradas"."productoras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."pagos" ADD CONSTRAINT "pagos_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "entradas"."usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Reglas que la base hace cumplir sola (escritas a mano) ─────────────────

-- Cargo por servicio entre 0% y 20%; la cuenta de Mercado Pago, completa o nada.
ALTER TABLE "entradas"."productoras" ADD CONSTRAINT "productoras_cobros_validos" CHECK (
  "recargo_mp_bps" BETWEEN 0 AND 2000
  AND ("mp_usuario_id" IS NULL) = ("mp_token_cifrado" IS NULL)
  AND ("mp_usuario_id" IS NULL OR "mp_usuario_id" ~ '^[0-9]+$')
);

ALTER TABLE "entradas"."ordenes" ADD CONSTRAINT "ordenes_recargo_valido" CHECK ("recargo_centavos" >= 0);

ALTER TABLE "entradas"."montos_transferencia" ADD CONSTRAINT "montos_transferencia_valido" CHECK ("monto_centavos" > 0);

-- Los confirmados a mano (y solo ellos) llevan "manual:" en vez de un número de Mercado Pago.
ALTER TABLE "entradas"."pagos" ADD CONSTRAINT "pagos_cobro_valido" CHECK (
  "comision_centavos" >= 0
  AND ("metodo" = 'MANUAL') = ("mp_pago_id" LIKE 'manual:%')
);
