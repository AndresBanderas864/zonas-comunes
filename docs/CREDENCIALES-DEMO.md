# Credenciales de demostración — Zonas+ v1

Todos los usuarios del seed comparten la contraseña: **`Demo1234!`**

> ⚠️ Solo datos ficticios de prueba (proyecto académico). No usar estas
> credenciales ni este esquema en producción.

## Roles del sistema

| Rol | Correo | Contraseña | Acceso |
|---|---|---|---|
| **Administrador** | `admin@ecc.local` | `Demo1234!` | `/admin/*`: zonas, apartamentos, invitaciones, usuarios, parámetros, reservas, estadísticas, bitácora |
| **Vigilante** | `vigilante@ecc.local` | `Demo1234!` | `/vigilancia` (programación del día, solo lectura) |

## Residentes (8 cuentas sembradas)

| Correo | Contraseña | Apartamento |
|---|---|---|
| `residente1@ecc.local` | `Demo1234!` | Torre A · 101 |
| `residente2@ecc.local` | `Demo1234!` | Torre A · 102 |
| `residente3@ecc.local` | `Demo1234!` | Torre A · 103 |
| `residente4@ecc.local` | `Demo1234!` | Torre A · 104 |
| `residente5@ecc.local` | `Demo1234!` | Torre B · 101 |
| `residente6@ecc.local` | `Demo1234!` | Torre B · 102 |
| `residente7@ecc.local` | `Demo1234!` | Torre B · 103 |
| `residente8@ecc.local` | `Demo1234!` | Torre B · 104 |

La **Torre C (101–104)** está sembrada sin cuenta de residente: úsala para
probar el flujo completo de invitación → registro → verificación de correo.

## Cómo crear un residente nuevo (flujo de invitación)

1. Entra como `admin@ecc.local`.
2. Ve a `Administración → Apartamentos` y pulsa *Invitar* en un apartamento
   libre (p. ej. C-101).
3. El enlace `/registro/<token>` se muestra **una sola vez** en pantalla;
   también queda impreso en el log del servidor (correo simulado en v1).
4. Abre el enlace en otra ventana, completa nombre/correo/contraseña, acepta
   la política y registra.
5. Verifica el correo con el enlace del log (o entra directamente si usas
   una cuenta sembrada: las 8 ya están verificadas).

## Otros datos del seed

- **Zonas:** Piscina, Gimnasio, Cancha, Zona de juegos, BBQ (con horarios
  lunes–domingo y bloques configurados).
- **Límites de reserva:** 7/semana · 3/día · 7 días de anticipación
  (ajustables en `/admin/parametros`).
- **Textos legales:** autorización, política de datos y aviso de privacidad
  v1 vigentes.
