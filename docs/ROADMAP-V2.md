# Roadmap — Zonas+ v2

## Prioridad 1: refactor completo del frontend (decisión del proyecto)

La **v1** entregó backend y reglas de negocio completas y probadas, pero su
interfaz (EJS + HTMX con estilos mínimos) es **provisional y será reescrita
por completo en la v2**. Lo que se conserva como contrato:

- Capas de servicio y repositorio (`src/modules/**/service.ts`,
  `repository.ts`) — lógica de negocio invariante.
- Rutas y códigos HTTP (tabla del README) — la v2 puede evolucionarlas con
  compatibilidad o versionarlas.
- Esquema de base de datos (`001_init.sql`) y convenciones de tiempo
  (`src/lib/fechas.ts`, sellos UTC, horas de negocio en Bogotá).

Alcance del refactor: rediseño de layouts y componentes visuales de las ~30
pantallas (reserva, administración, vigilancia, notificaciones, cuenta),
sistema de diseño propio (tokens, tipografía, componentes), accesibilidad
verificada más allá del contraste 4.5:1 actual, y flujos móviles (la idea
original del proyecto es una app móvil: evaluar PWA o capa de app sobre las
mismas rutas).

## Prioridad 2: endurecimiento (backlog triado de la revisión final de la v1)

Seguridad y concurrencia (no bloqueantes, verificados como benignos hoy):

1. `FOR UPDATE` sobre `USUARIO` en recuperación de contraseña y sesiones
   (hoy dos solicitudes concurrentes pueden dejar dos tokens de reset
   válidos para el mismo usuario; uno de un solo uso).
2. `crearRecordatorios` depende de que sus locks sean compartidos: añadir el
   comentario de orden de locks (`APARTAMENTO → OCUPACION_BLOQUE → RESERVA`)
   para que nadie los promueva a exclusivas sin ver el deadlock.
3. `desactivarUsuario` cruzado concurrente (dos admins desactivándose) →
   1213 sin reintento: envolver con `conReintento`.
4. Rate limit en respuestas 429 de navegador: hoy devuelven JSON; renderizar
   el formulario con mensaje de espera.
5. `obtenerParametros` escribe (INSERT IGNORE) en la ruta de lectura del
   booking: mover a seed/migración y dejarlo lectura pura.

Cumplimiento y datos personales:

6. Barrido diario de `INVITACION` vencida (marcar `VENCIDA`) y poda de
   `TOKEN_VERIFICACION` muertos en `jobs/limpieza.ts`.
7. Decisión de política: al desactivar un apartamento con reservas
   confirmadas, ¿cancelar cupos liberándolos? (hoy quedan ocupados hasta
   vencer).
8. Anonimización/supresión de datos (RF-10/RF-12, fuera de v1 por alcance).

Calidad interna:

9. Borrar dead code: `src/views/reservas/mis-reservas.ejs` y
   `repository.listarReservasNoCanceladas`.
10. Unificar etiquetas de estado de reserva (hoy triplicadas en vistas).
11. `GET /verificar/:token` muta estado con token de capacidad: aceptar por
    diseño o exigir sesión.
12. Filtros de auditoría/estadísticas aplican fechas Bogotá sobre sellos UTC
    (ventanas ±5 h): alinear al hacer el rediseño de vistas.
13. `DEFAULT CURRENT_TIMESTAMP(3)` latente en `DISPOSITIVO_PUSH` y
    `SOLICITUD_DATOS`: pasar a `DEFAULT (UTC_TIMESTAMP(3))` cuando reciban
    escritores.

## Integraciones reales (fueron simuladas en v1 por diseño, §20)

- SMTP real (hoy los enlaces salen por log del servidor).
- Push real vía FCM/APNs si la v2 es app móvil.
- QR de invitación (RF-01) para portería.
