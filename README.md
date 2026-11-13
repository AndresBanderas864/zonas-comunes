# Zonas+ — Horarios de zonas comunes

Sistema web para la organización de zonas comunes de un conjunto residencial
(piscina, BBQ, gimnasio, cancha, juegos): invitación y registro de residentes,
reservas con control de aforo y concurrencia, cancelación, notificaciones
in-app, vigilancia, estadísticas, bitácora de auditoría y autenticación con
bloqueo y recuperación de contraseña.

Stack: Node.js 22 + TypeScript, Express 5, EJS (+ HTMX), MariaDB 11, Vitest +
Supertest. Sin ORM: todo el SQL es parametrizado.

## Estado — Versión 1 (prototipo)

Esta es la **primera versión**. El backend, las reglas de negocio, el control
de aforo bajo concurrencia y la cobertura de requerimientos están completos y
probados (198 pruebas, recorrido end-to-end incluido).

**La interfaz de usuario (frontend) NO es definitiva: se refactorizará por
completo en la v2.** Los layouts, componentes visuales y flujos de pantallas
actuales son provisionales y se rediseñarán desde cero; la lógica de negocio
(capas de servicio y repositorio) y las rutas se conservarán como contrato.

Credenciales y datos de prueba: [docs/CREDENCIALES-DEMO.md](docs/CREDENCIALES-DEMO.md).

## Requisitos

- Node.js 22 o superior.
- Docker (para la base de datos MariaDB 11 vía `docker-compose.yml`).
- `TZ=America/Bogota` en el entorno del proceso (viene fijada en
  `docker-compose.yml` y `.env.example`; la suite la verifica con
  `tests/tz-guard.test.ts`).

## Arranque rápido

```bash
docker compose up -d mariadb   # base de datos (puerto 3306, usuario ecc/ecc)
npm install
cp .env.example .env           # ajusta SESSION_SECRET (>= 32 caracteres)
npm run migrate                # aplica src/db/migrations/*.sql
npm run seed                   # datos de demostración
npm run dev                    # http://localhost:3000
```

Scripts disponibles: `dev`, `start`, `migrate`, `seed`, `test`, `build`
(typecheck `tsc --noEmit`).

## Credenciales demo (seed)

Todas con la contraseña `Demo1234!`:

| Rol | Correo |
|---|---|
| Administrador | `admin@ecc.local` |
| Vigilante | `vigilante@ecc.local` |
| Residentes 1–8 | `residente1@ecc.local` … `residente8@ecc.local` |

El seed crea además 3 torres (A, B, C) con 4 apartamentos cada una (101–104),
5 zonas con horarios de lunes a domingo, parámetros de reserva (7/semana,
3/día, 7 días de anticipación) y los textos legales vigentes.

## Mapa de rutas

Públicas:

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Redirige según sesión (login o panel) |
| GET | `/health` | Estado del servicio y de la base de datos |
| GET/POST | `/login` | Inicio de sesión (rate limit: 10/15 min por IP) |
| POST | `/logout` | Cierra la sesión |
| GET/POST | `/recuperar` | Solicitud de recuperación (rate limit: 5/15 min por IP) |
| GET/POST | `/restablecer/:token` | Nueva contraseña con token |
| GET/POST | `/registro/:token` | Registro con invitación |
| GET | `/verificar/:token` | Verificación de correo |
| GET | `/politica` | Política de datos personales (RF-39) |
| GET | `/aviso-privacidad` | Aviso de privacidad (RF-39) |

Autenticadas (cualquier rol, según módulo):

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/reservar` | Elegir zona y fecha |
| GET | `/reservar/:zonaId/:fecha` | Disponibilidad por bloques |
| POST | `/reservas` | Crear reserva (confirmación; 409 sin cupo/duplicado) |
| POST | `/reservas/:id/cancelar` | Cancelar (propia o como admin) |
| GET | `/mis-reservas` | Historial del apartamento (próximas y pasadas) |
| GET | `/notificaciones` | Bandeja in-app |
| POST | `/notificaciones/:id/leida` | Marcar leída |
| GET | `/mi-cuenta` | Datos personales mínimos |
| POST | `/mi-cuenta/nombre` | Rectificar nombre |
| POST | `/mi-cuenta/politica` | Registrar aceptación de política |

Vigilancia (`VIGILANTE` o `ADMINISTRADOR`):

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/vigilancia` | Reservas del día, solo lectura |

Administración (`ADMINISTRADOR`, bajo `/admin`):

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/admin/zonas`, `/admin/zonas/nueva`, `/admin/zonas/:id` | Zonas y horarios |
| POST | `/admin/zonas/nueva`, `/admin/zonas/:id` | Crear/editar zona |
| GET/POST | `/admin/parametros` | Parámetros de reserva |
| GET | `/admin/apartamentos`, `/admin/apartamentos/:id` | CRUD de apartamentos |
| POST | `/admin/apartamentos`, `/admin/apartamentos/:id`, `/admin/apartamentos/:id/eliminar` | Crear/editar/eliminar |
| GET/POST | `/admin/invitaciones` | Crear y listar invitaciones |
| POST | `/admin/invitaciones/:id/revocar` | Revocar invitación |
| GET | `/admin/usuarios` | Listado de usuarios |
| POST | `/admin/usuarios/:id/desactivar` | Desactivar cuenta (RF-42) |
| GET | `/admin/reservas` | Supervisión de reservas con filtros |
| GET | `/admin/estadisticas` | Ocupación, horas pico y cancelaciones |
| GET | `/admin/bitacora` | Bitácora de auditoría (RF-41) |

## Pruebas

La suite requiere MariaDB arriba:

```bash
docker compose up -d mariadb
npm test
```

Cada corrida crea y destruye su propia base `ecc_test_<pid>` (migraciones del
global setup, truncado por archivo en `beforeEach`), corre en serie
(`fileParallelism: false`) y verifica la zona `America/Bogota`. Incluye el
recorrido end-to-end completo (`tests/e2e.test.ts`) y las pruebas de
concurrencia por bloque (`tests/concurrencia.test.ts`).

Typecheck: `npm run build`.

## Decisiones de alcance

El diseño (§20 de `docs/superpowers/specs/2026-11-12-zonas-comunes-design.md`)
recorta deliberadamente: QR físico (el enlace de invitación sí se implementa),
push real y SMTP real (se simulan por log), cifrado en reposo, alta
disponibilidad y respaldos automáticos, solicitudes formales de datos con
plazos legales (`SOLICITUD_DATOS`), anonimización/supresión (RF-12), cambio de
correo (RF-08), app nativa y exportación de estadísticas. Eso es trabajo
futuro, no defectos. Detalles operativos: [docs/operacion.md](docs/operacion.md).
