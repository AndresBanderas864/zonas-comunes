SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS APARTAMENTO (
  id CHAR(36) NOT NULL,
  torre_interior VARCHAR(20) NOT NULL,
  numero VARCHAR(20) NOT NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_apartamento_torre_numero (torre_interior, numero)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS USUARIO (
  id CHAR(36) NOT NULL,
  rol VARCHAR(20) NOT NULL,
  apartamento_id CHAR(36) NULL,
  nombre VARCHAR(120) NOT NULL,
  correo VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA',
  correo_verificado TINYINT(1) NOT NULL DEFAULT 0,
  intentos_fallidos INT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_hasta DATETIME(3) NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuario_correo (correo),
  KEY idx_usuario_apartamento_estado (apartamento_id, estado),
  CONSTRAINT fk_usuario_apartamento FOREIGN KEY (apartamento_id) REFERENCES APARTAMENTO (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_usuario_rol CHECK (rol IN ('RESIDENTE', 'ADMINISTRADOR', 'VIGILANTE')),
  CONSTRAINT chk_usuario_estado CHECK (estado IN ('PENDIENTE', 'ACTIVA', 'DESACTIVADA', 'BAJA')),
  CONSTRAINT chk_usuario_residente_apartamento CHECK (rol <> 'RESIDENTE' OR apartamento_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TEXTO_LEGAL (
  id CHAR(36) NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  version INT UNSIGNED NOT NULL,
  contenido TEXT NOT NULL,
  vigente_desde DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_texto_legal_tipo_version (tipo, version),
  CONSTRAINT chk_texto_legal_tipo CHECK (tipo IN ('AUTORIZACION', 'POLITICA', 'AVISO_PRIVACIDAD'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS INVITACION (
  id CHAR(36) NOT NULL,
  apartamento_id CHAR(36) NOT NULL,
  creada_por CHAR(36) NOT NULL,
  usuario_id CHAR(36) NULL,
  token_hash CHAR(64) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'VIGENTE',
  creada_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  vence_en DATETIME(3) NOT NULL,
  usada_en DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invitacion_token (token_hash),
  KEY idx_invitacion_apartamento_estado (apartamento_id, estado),
  CONSTRAINT fk_invitacion_apartamento FOREIGN KEY (apartamento_id) REFERENCES APARTAMENTO (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_invitacion_creada_por FOREIGN KEY (creada_por) REFERENCES USUARIO (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_invitacion_usuario FOREIGN KEY (usuario_id) REFERENCES USUARIO (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_invitacion_estado CHECK (estado IN ('VIGENTE', 'USADA', 'REVOCADA', 'VENCIDA'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TOKEN_VERIFICACION (
  id CHAR(36) NOT NULL,
  usuario_id CHAR(36) NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  correo_nuevo VARCHAR(254) NULL,
  vence_en DATETIME(3) NOT NULL,
  usado_en DATETIME(3) NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_token_verificacion_token (token_hash),
  KEY idx_token_verificacion_usuario_tipo (usuario_id, tipo),
  CONSTRAINT fk_token_verificacion_usuario FOREIGN KEY (usuario_id) REFERENCES USUARIO (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_token_verificacion_tipo CHECK (tipo IN ('VERIFICAR_CORREO', 'RESTABLECER_PASSWORD', 'CAMBIO_CORREO'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS SESION (
  id CHAR(36) NOT NULL,
  usuario_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  ultimo_uso DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revocada_en DATETIME(3) NULL,
  creada_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sesion_token (token_hash),
  KEY idx_sesion_usuario_ultimo_uso (usuario_id, ultimo_uso),
  CONSTRAINT fk_sesion_usuario FOREIGN KEY (usuario_id) REFERENCES USUARIO (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS DISPOSITIVO_PUSH (
  id CHAR(36) NOT NULL,
  usuario_id CHAR(36) NOT NULL,
  token_push VARCHAR(512) NOT NULL,
  plataforma VARCHAR(20) NOT NULL,
  registrado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_dispositivo_usuario (usuario_id),
  CONSTRAINT fk_dispositivo_usuario FOREIGN KEY (usuario_id) REFERENCES USUARIO (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_dispositivo_plataforma CHECK (plataforma IN ('ANDROID', 'IOS'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS AUTORIZACION_DATOS (
  id CHAR(36) NOT NULL,
  usuario_id CHAR(36) NOT NULL,
  texto_legal_id CHAR(36) NOT NULL,
  aceptada_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revocada_en DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_autorizacion_usuario_texto (usuario_id, texto_legal_id),
  CONSTRAINT fk_autorizacion_usuario FOREIGN KEY (usuario_id) REFERENCES USUARIO (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_autorizacion_texto FOREIGN KEY (texto_legal_id) REFERENCES TEXTO_LEGAL (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ZONA (
  id CHAR(36) NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  aforo INT UNSIGNED NOT NULL,
  duracion_bloque_min INT UNSIGNED NOT NULL,
  max_cupos_reserva INT UNSIGNED NOT NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_zona_nombre (nombre),
  CONSTRAINT chk_zona_aforo CHECK (aforo > 0),
  CONSTRAINT chk_zona_duracion CHECK (duracion_bloque_min > 0),
  CONSTRAINT chk_zona_max_cupos CHECK (max_cupos_reserva > 0),
  CONSTRAINT chk_zona_max_cupos_aforo CHECK (max_cupos_reserva <= aforo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS HORARIO_ZONA (
  id CHAR(36) NOT NULL,
  zona_id CHAR(36) NOT NULL,
  dia_semana TINYINT UNSIGNED NOT NULL,
  apertura TIME NOT NULL,
  cierre TIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_horario_zona_dia (zona_id, dia_semana),
  CONSTRAINT fk_horario_zona FOREIGN KEY (zona_id) REFERENCES ZONA (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_horario_dia CHECK (dia_semana BETWEEN 1 AND 7),
  CONSTRAINT chk_horario_cierre CHECK (cierre > apertura)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS PARAMETRO_RESERVA (
  id TINYINT UNSIGNED NOT NULL,
  max_reservas_semana INT UNSIGNED NOT NULL,
  max_reservas_dia INT UNSIGNED NOT NULL,
  anticipacion_dias INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_parametro_unico CHECK (id = 1),
  CONSTRAINT chk_parametro_dia_semana CHECK (max_reservas_dia <= max_reservas_semana)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS RESERVA (
  id CHAR(36) NOT NULL,
  apartamento_id CHAR(36) NULL,
  zona_id CHAR(36) NOT NULL,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  cupos INT UNSIGNED NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'CONFIRMADA',
  cancelada_por VARCHAR(20) NULL,
  cancelada_por_usuario CHAR(36) NULL,
  motivo_cancelacion VARCHAR(255) NULL,
  creada_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  cancelada_en DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_reserva_zona_fecha_estado (zona_id, fecha, estado),
  KEY idx_reserva_apartamento_fecha (apartamento_id, fecha),
  KEY idx_reserva_fecha_estado (fecha, estado),
  CONSTRAINT fk_reserva_apartamento FOREIGN KEY (apartamento_id) REFERENCES APARTAMENTO (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_reserva_zona FOREIGN KEY (zona_id) REFERENCES ZONA (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_reserva_cancelada_por FOREIGN KEY (cancelada_por_usuario) REFERENCES USUARIO (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_reserva_cupos CHECK (cupos > 0),
  CONSTRAINT chk_reserva_horas CHECK (hora_fin > hora_inicio),
  CONSTRAINT chk_reserva_estado CHECK (estado IN ('CONFIRMADA', 'CANCELADA', 'VENCIDA')),
  CONSTRAINT chk_reserva_cancelada_por CHECK (cancelada_por IS NULL OR cancelada_por IN ('RESIDENTE', 'ADMINISTRADOR', 'SISTEMA'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS NOTIFICACION (
  id CHAR(36) NOT NULL,
  usuario_id CHAR(36) NOT NULL,
  reserva_id CHAR(36) NULL,
  tipo VARCHAR(20) NOT NULL,
  titulo VARCHAR(120) NOT NULL,
  mensaje TEXT NOT NULL,
  leida TINYINT(1) NOT NULL DEFAULT 0,
  creada_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notificacion_usuario_leida (usuario_id, leida),
  CONSTRAINT fk_notificacion_usuario FOREIGN KEY (usuario_id) REFERENCES USUARIO (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_notificacion_reserva FOREIGN KEY (reserva_id) REFERENCES RESERVA (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_notificacion_tipo CHECK (tipo IN ('CONFIRMACION', 'CANCELACION', 'RECORDATORIO'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ENVIO_NOTIFICACION (
  id CHAR(36) NOT NULL,
  notificacion_id CHAR(36) NOT NULL,
  canal VARCHAR(20) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  intentos INT UNSIGNED NOT NULL DEFAULT 0,
  ultimo_intento DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_envio_estado_canal (estado, canal),
  CONSTRAINT fk_envio_notificacion FOREIGN KEY (notificacion_id) REFERENCES NOTIFICACION (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_envio_canal CHECK (canal IN ('CORREO', 'PUSH')),
  CONSTRAINT chk_envio_estado CHECK (estado IN ('PENDIENTE', 'ENVIADO', 'FALLIDO')),
  CONSTRAINT chk_envio_intentos CHECK (intentos BETWEEN 0 AND 3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS SOLICITUD_DATOS (
  id CHAR(36) NOT NULL,
  usuario_id CHAR(36) NULL,
  tipo VARCHAR(20) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'RECIBIDA',
  recibida_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  vence_en DATETIME(3) NULL,
  prorrogada TINYINT(1) NOT NULL DEFAULT 0,
  atendida_en DATETIME(3) NULL,
  respuesta TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_solicitud_usuario_estado (usuario_id, estado),
  CONSTRAINT fk_solicitud_usuario FOREIGN KEY (usuario_id) REFERENCES USUARIO (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_solicitud_tipo CHECK (tipo IN ('CONSULTA', 'RECLAMO', 'SUPRESION', 'REVOCATORIA')),
  CONSTRAINT chk_solicitud_estado CHECK (estado IN ('RECIBIDA', 'EN_TRAMITE', 'PRORROGADA', 'ATENDIDA'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS BITACORA (
  id CHAR(36) NOT NULL,
  usuario_id CHAR(36) NOT NULL,
  accion VARCHAR(80) NOT NULL,
  entidad VARCHAR(80) NOT NULL,
  entidad_id CHAR(36) NOT NULL,
  detalle JSON NULL,
  creada_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_bitacora_creada_en (creada_en),
  CONSTRAINT fk_bitacora_usuario FOREIGN KEY (usuario_id) REFERENCES USUARIO (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS OCUPACION_BLOQUE (
  zona_id CHAR(36) NOT NULL,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  cupos_ocupados INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (zona_id, fecha, hora_inicio),
  CONSTRAINT fk_ocupacion_zona FOREIGN KEY (zona_id) REFERENCES ZONA (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_ocupacion_no_negativa CHECK (cupos_ocupados >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
