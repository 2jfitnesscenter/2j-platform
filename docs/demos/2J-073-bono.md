# Demo — flujo de bono 2J-073

1. En **Servicios → Planes**, crear un `Bono 10 sesiones` con tipo **Bono de sesiones**, saldo inicial 10, fecha final definida y precio base opcional; activar el producto.
2. En Cliente 360 asignarlo a un cliente activo, introducir precio de venta y dejar el cargo pendiente o registrar el cobro de forma explícita.
3. En **Cuotas**, comprobar `10 restantes` y abrir **Ver movimientos**; aparece la concesión inicial de `+10`.
4. Seleccionar **Ajustar saldo**, introducir `-1` y un motivo con al menos 3 caracteres. Repetir la misma petición con la misma clave da replay; un ajuste que dejaría saldo negativo da conflicto.
5. Abrir movimientos para ver el ajuste `-1`; quedan 9. SQL no permite editar o borrar un movimiento, ni siquiera con acceso directo a la tabla.
6. Ajustar por `-9` permite comprobar el estado derivado `Bono agotado`; no se borra el bono ni se consume nada desde Calendario.

No se utiliza `consume`: el saldo solo cambiará por concesiones/ajustes en 2J-073. El consumo atómico y la compensación de una cancelación pertenecen a 2J-074.
