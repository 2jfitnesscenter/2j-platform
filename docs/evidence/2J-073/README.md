# Evidencia visual 2J-073

Esta carpeta debe contener capturas reales del preview, sin retocar contenido, al cerrar el SHA de revisión.

Matriz de verificación prevista: **1440 px** escritorio (Cliente 360 Cuotas, catálogo, movimientos), **768 px** tablet (lista/detalle apilado y acciones), **390 px** móvil (venta, confirmación/ajuste y lectura de saldo). Incluir también una cuota activa, bono con saldo y Training limited/full.

No se adjuntan capturas: el preview local pudo iniciarse, pero el control del navegador se detuvo porque no pudo verificar con suficiente confianza la URL activa. Por tanto no se inspeccionaron las vistas a 1440/768/390 px y no se presentan imágenes simuladas. La re-review UX/QA debe capturar el mismo SHA candidato con un navegador verificable antes de aprobarlo visualmente.

La suite de UI pasa en jsdom (56/56), pero no sustituye evidencia visual responsive real. El preview usa únicamente la base desechable `2j_demo` con datos sintéticos; no accede a datos productivos.
