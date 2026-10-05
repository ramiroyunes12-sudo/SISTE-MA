-- La contraseña temporal vence (72 horas desde que se da). null = no vence.

-- AlterTable
ALTER TABLE "entradas"."usuarios" ADD COLUMN     "temporal_vence_en" TIMESTAMPTZ(3);
