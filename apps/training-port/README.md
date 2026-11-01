# training-port (WIP, A81 tranche 1)

Copia sin modificar de la lógica pura (sin React ni API) y de los estilos CSS de `2jfitnessapp` (Búnker actual), para portarlos al módulo de entrenamiento de Platform (A81, A84, A85).

- No es un paquete de pnpm ni está en ningún tsconfig: no entra en typecheck, build ni tests.
- No se conecta a nada todavía. Cada fichero se portará a TypeScript y a los tokens de Platform antes de usarse.
- Mapa de clasificación: `apps/training-port/MAP.tsv`.
