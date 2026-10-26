# Minutos de GitHub Actions: medición y presupuesto

Objetivo: que el CI de `2j-platform` quepa muy por debajo de 2.000 minutos al mes, de modo que el repositorio pueda pasar a privado más adelante sin coste (plan gratuito: 2.000 min/mes en repos privados). Hoy el repo es público y Actions es gratis; esto es un seguro, no una urgencia.

## 1. Medición (antes), últimos 30 días hasta el 25 oct 2026

Fuente: API de Actions (ejecuciones y duración de cada job). La API de «billable» devuelve 0 en repos públicos, así que los minutos se han calculado como la duración de cada job **redondeada al minuto hacia arriba** (así factura GitHub), sobre una muestra de 62 ejecuciones.

| Workflow / job | Ejecuciones | Minutos facturables por ejecución |
|---|---|---|
| Quality and security · `quality` | 857 | 2,5 (media de 2 min 6 s) |
| Quality and security · `secret scan` | 857 | 1,35 (media de 53 s) |
| E2E Home-Platform-Búnker | 17 (el workflow nació el 24 oct) | 4 |

Desglose de las 857 ejecuciones de calidad: 395 por `pull_request`, 376 por `push` a ramas `agent/**` (duplican la ejecución de la PR) y 86 por `push` a `main`. 177 ejecuciones (20 %) terminaron en rojo.

**Total medido: ~3.400 min/mes** (857 × 3,85 + 17 × 4). Si el E2E hubiera corrido en todas las PR como hará de ahora en adelante, serían unos 4.900.

## 2. Qué cambia

1. `quality.yml` solo corre en `pull_request` y en `main`: se quita el `push` a `agent/**` (era una segunda ejecución del mismo código). Una rama sin PR no tiene CI hasta que se abre la PR.
2. `concurrency` con cancelación en PR: un push nuevo a la misma PR cancela la ejecución anterior (en `main` no se cancela nada).
3. Cambios que solo tocan `docs/`, `tasks/` o `*.md` saltan instalación, tests, build y auditoría (el job `quality` sigue figurando como correcto; el escaneo de secretos corre siempre).
4. `e2e-training.yml` solo corre cuando cambia algo que puede afectarle (`apps/api`, `apps/client-app`, `packages`, `tooling/e2e`, lockfile, `package.json`, `pnpm-workspace.yaml`, `turbo.json` o el propio workflow) y con la misma cancelación. Cambios de admin-web, staff-app o documentación no lo lanzan. **No corre en PR en borrador** (al marcar la PR como lista, se lanza) **ni tras cada fusión a `main`**: lo sustituye una ejecución semanal programada (lunes 04:17 UTC) más `workflow_dispatch`.
5. El escaneo de secretos cachea la compilación de gitleaks (clave fijada al commit del escáner y a la versión de Go).

No se tocan `fetch-depth: 0` del escaneo ni su alcance: sigue mirando todo el historial.

## 3. Proyección (después)

Hipótesis con datos reales de las 826 ejecuciones medidas en el historial: 33 % de los cambios solo tocan documentación; 57 % tocan algo que afecta al E2E. **Supuestos no medidos:** 5 % de las ejecuciones de PR se cancelan por supersesión; 70 % de las ejecuciones de PR pertenecen a PR ya marcadas como listas (el resto, borradores, no lanzan E2E).

| Concepto | Cálculo | Minutos/mes |
|---|---|---|
| Ejecuciones de calidad | 375 PR + 86 `main` = 461 | |
| `quality` | 461 × (0,75 × 2,5 + 0,25 × 1,0) | ~980 |
| `secret scan` | 461 × 1,0 (con caché) | ~460 |
| E2E en PR | 375 × 0,70 × 0,57 × 4 | ~600 |
| E2E semanal sobre `main` | 4 × 4 | ~16 |
| **Total proyectado** | | **~2.050** (rango razonable 1.800–2.300) |

**Conclusión honesta:** con estos cambios el uso baja de ~3.400 (y de ~4.900 con el E2E en todas las PR) a ~2.050, pero **no queda «muy por debajo de 2.000»**. El mes medido fue de volumen excepcional (857 ejecuciones, 20 % en rojo). Palancas adicionales **no activadas** (decide el propietario):

| Palanca | Ahorro aprox. | Coste |
|---|---|---|
| No ejecutar `quality` ni `secret scan` en el `push` a `main` (la PR ya los pasó) | ~270 min | Se pierde la comprobación posterior a la fusión; aceptable mientras se actualice `main` antes de cada fusión |
| `quality` solo en PR listas (borradores solo `secret scan`) | ~25–35 % de `quality` | Un borrador no tiene tests hasta marcarlo como listo; incómodo para el trabajo iterativo de los agentes |
| Bajar el E2E a 3 min (caché de dependencias de Búnker) | ~150 min | Poco |

Activando la primera palanca la proyección queda en ~1.780 min/mes. Recomiendo **medir de nuevo tras una semana** con este cambio antes de decidir más recortes; la proyección depende de los dos supuestos no medidos.

## 4. Cómo volver a medir

```bash
gh api "repos/2jfitnesscenter/2j-platform/actions/runs?per_page=100&created=>=$(date -u -d '30 days ago' +%F)" --paginate \
  --jq '.workflow_runs[] | [.id,.name,.event,.head_branch] | @tsv'
# y, por ejecución: gh api repos/2jfitnesscenter/2j-platform/actions/runs/<id>/jobs
```

Minutos de un job = duración redondeada hacia arriba al minuto; multiplicador 1 para Ubuntu. Comparar con el mismo cálculo tras un mes completo con este cambio.
