# Propuesta de diseño: caja, traspasos y conteo por denominación

**Estado:** propuesta para decisión del propietario. No autoriza implementación.
**Decisiones de referencia:** D96–D98, D110–D114, D111, D123, D112 y A39–A41.

## Objetivo

Definir cómo se controla quién custodia el efectivo durante el horario del centro, cómo se traspasa entre profesionales y cómo se registran apertura, traspaso y cierre mediante conteos ciegos por denominación. Esta propuesta es posterior e independiente de D113 (#97); D113 conserva su alcance actual.

## Flujo propuesto

### Apertura

- Solo puede abrir caja un profesional con fichaje de entrada efectivo y autorización para gestionar caja.
- El profesional cuenta las monedas y billetes y registra la cantidad de cada denominación. El servidor calcula el total; no se permite introducir un total independiente.
- La referencia inicial es **50 €**, pero se registra siempre el efectivo real contado, aunque sea superior o inferior. La propuesta no arrastra automáticamente el saldo del día anterior.
- Denominaciones: monedas de 1, 2, 5, 10, 20 y 50 céntimos, 1 € y 2 €; billetes de 5 €, 10 €, 20 €, 50 €, 100 €, 200 € y 500 €.

### Custodia durante el día y traspaso

- Puede haber varios traspasos en el mismo día. Cada uno es un movimiento auditable, vinculado a la caja y a los profesionales saliente y entrante.
- El profesional saliente cuenta y confirma cada denominación. El entrante realiza su propio conteo ciego, sin ver el conteo saliente ni el saldo esperado, y confirma por separado.
- La caja cambia de titular solo después de que ambos confirmen. El historial conserva ambos conteos, actores y marcas de tiempo.
- Si los totales no coinciden, se registra una discrepancia y queda visible únicamente para quien tenga `owner.panel.read`. **Decisión requerida:** elegir si el traspaso queda en espera de resolución del propietario o si cambia de titular al confirmarlo ambos y la discrepancia queda pendiente de revisión. Recomendación: permitir el cambio de titular y crear una incidencia visible solo para el propietario, para evitar que el centro se quede sin custodio.
- Un profesional no puede fichar la salida mientras mantenga una caja abierta, salvo que la cierre o complete un traspaso a otro profesional que ya haya fichado la entrada.

### Cobertura del horario

- Contrastar el horario de apertura del centro con los turnos/sesiones de los profesionales y los intervalos en que cada uno tiene la custodia.
- Mostrar al propietario los intervalos en que el centro está abierto y no hay un custodio de caja asignado. Una ausencia de cobertura es un aviso operativo; no se inventan fichajes ni se modifica el horario laboral.
- La fuente autoritativa de horario del centro y la granularidad de los turnos deben ser las existentes en Platform. Si no cubren el calendario real de apertura, se deberá definir esa fuente antes de implementar alertas fiables.

### Cierre

- El profesional cuenta por denominación de forma ciega; nunca ve el saldo esperado antes de confirmar.
- El servidor calcula el total contado y lo compara con el esperado: fondo de apertura + cobros en efectivo − devoluciones/anulaciones en efectivo, considerando los movimientos de caja registrados.
- El profesional cierra la caja después de registrar el conteo. La diferencia, su explicación obligatoria (D97) y la validación administrativa se rigen por D97. La diferencia se muestra solo al propietario (`owner.panel.read`), nunca al gerente ni al personal.
- Solo después de cerrar la caja el profesional puede fichar la salida.

## Vista diaria exclusiva del propietario

Con permiso `owner.panel.read`, mostrar el detalle del día: apertura, cobros, devoluciones/anulaciones, traspasos, conteos por denominación, profesional custodio en cada intervalo, diferencias y estado equilibrado/no equilibrado. Solo el propietario puede consultar el conjunto de movimientos, los conteos de ambas partes de cada traspaso y las diferencias. Cada profesional puede introducir y confirmar su propio conteo, pero nunca ve el saldo esperado ni el conteo de la otra parte durante el proceso ciego. El gerente no recibe diferencias ni la vista diaria reservada al propietario.

## Olvido de cierre

La propuesta es que solo el propietario resuelva una caja que quedó abierta, mediante una acción explícita y auditada con motivo, actor y hora real de resolución. No se crea una hora de salida laboral retroactiva ni se altera el historial del fichaje (D123). Si hace falta registrar un cierre de caja corregido, debe conservarse el conteo y la corrección como eventos distintos. **Aprobación requerida:** confirmar este mecanismo y si el propietario puede cerrar una caja sin que el profesional esté presente, con motivo obligatorio.

## Decisiones que debe aprobar el propietario

1. **Discrepancia en traspaso:** ¿se completa el cambio de custodio tras las dos confirmaciones y se deja una incidencia solo para el propietario (recomendado), o se bloquea hasta resolución?
2. **Fondo del día siguiente:** se propone sugerir 50 € como referencia, solicitar siempre conteo real y no copiar automáticamente el cierre anterior. ¿Se aprueba?
3. **Caja olvidada abierta:** ¿puede resolverla únicamente el propietario con acción auditada, motivo y conteo real, sin modificar fichajes? ¿Puede hacerlo sin presencia del profesional?
4. **Cobertura:** confirmar qué calendario de apertura y qué fuente de turnos se consideran autoritativos para detectar intervalos sin custodio.

## Límites de alcance

- Esta propuesta no cambia D113 (#97): los cobros y devoluciones que requieran caja siguen sujetos a una sesión abierta; validar un justificante de transferencia conserva la excepción de D102.
- No se implementan todavía traspasos, conteos por denominación, alertas de cobertura ni cierre por propietario.
- El efectivo esperado nunca se presenta a quien realiza un conteo ciego.
- No se crean movimientos manuales de entrada/salida de caja (D98).

## Aprobación solicitada

Revisar y responder las cuatro decisiones anteriores. La implementación de traspasos y denominaciones comienza únicamente después de aprobar esta propuesta y se entregará en PRs pequeños con pruebas y auditoría.
