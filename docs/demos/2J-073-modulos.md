# Demo — acceso a módulos 2J-073

1. En el catálogo, crear un producto con **Training → Limitado**, por ejemplo capability `training.routines.read`; asignarlo a un cliente.
2. Abrir Cliente 360 → **Cuotas** y comprobar nivel y capabilities del snapshot. En el read model efectivo, el módulo debe aparecer como `limited` con esa capability.
3. Crear/activar un producto distinto con **Training → Completo**, asignarlo a otro cliente y comprobar `full`. Si dos asignaciones activas de un mismo cliente conceden `limited` y `full`, la respuesta agregada es `full` y une capabilities.
4. Nutrición y Salud se pueden configurar como contratos de catálogo, pero no se habilitan interfaces o integraciones nuevas aquí. El mismo `client_id` central queda ligado a cada asignación; ningún módulo crea otro cliente.

Endpoint para QA: `GET /api/clients/{clientId}/entitlements/effective`. Cada módulo hijo deberá consultar este contrato central en una fase posterior; 2J-073 no delega la autoridad sobre entitlements a Búnker o a una app hija.
