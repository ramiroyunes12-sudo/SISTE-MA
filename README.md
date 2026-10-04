# Sistema de entradas

Venta de entradas por lotes con QR enviado por mail y validación en la puerta.

- Plan general: [PLAN.md](PLAN.md)
- Pasos y avance: [PASOS.md](PASOS.md)
- Diseño de pantallas: https://claude.ai/artifact/TEQZ3qY3s5V2eufJfgSWtJ

## Correrlo en tu compu

Necesitás **Node.js 20.9 o más nuevo** (versión LTS de nodejs.org) y **Git**.

```bash
git clone https://github.com/ramiroyunes12-sudo/SISTE-MA.git
cd SISTE-MA
npm install       # baja las librerías (solo la primera vez)
npm run dev       # levanta el sistema
```

Después abrí http://localhost:3000 en el navegador.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta el sistema en modo desarrollo (se actualiza solo al guardar). |
| `npm run build` | Arma la versión final optimizada. |
| `npm run start` | Corre la versión armada con `build`. |
| `npm run lint` | Revisa errores comunes en el código. |
| `npm run typecheck` | Revisa los tipos de TypeScript. |

## Tecnologías

- [Next.js 16](https://nextjs.org) (App Router) + TypeScript
- [Tailwind CSS 4](https://tailwindcss.com) para los estilos
