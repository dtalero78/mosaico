/**
 * Definiciones de Permisos - LGS Admin Panel
 * Catálogo completo de permisos disponibles en el sistema
 * Cada permiso indica exactamente qué componente, página o botón controla
 */

import {
  Permission,
  PermissionDefinition,
  Module,
  PersonPermission,
  StudentPermission,
  AcademicoPermission,
  InformesPermission,
  ServicioPermission,
  ComercialPermission,
  AprobacionPermission,
  MantenimientoPermission,
  RecaudosPermission,
} from '@/types/permissions';

// ============================================================================
// CATÁLOGO DE PERMISOS
// ============================================================================

export const PERMISSIONS_CATALOG: PermissionDefinition[] = [
  // ========== PERSON MODULE (Página: /person/[id]) ==========
  {
    code: PersonPermission.DESCARGAR_CONTRATO,
    module: Module.PERSON,
    section: 'Información General',
    name: 'Botón "Descargar Contrato"',
    description: 'Botón para descargar el PDF del contrato del titular',
  },
  {
    code: PersonPermission.VER_CONTRATO,
    module: Module.PERSON,
    section: 'Información General',
    name: 'Botón "Ver Contrato"',
    description: 'Botón que abre un modal con la plantilla del contrato completamente llenada (solo lectura, sin opciones de impresión/firma/envío PDF)',
  },
  {
    code: PersonPermission.ASIGNAR_GESTOR_RECAUDO,
    module: Module.PERSON,
    section: 'Financiera',
    name: 'Botón "Asignar Ejecutivo de Recaudos"',
    description: 'Botón en la pestaña Financiera del titular para asignar/reasignar el gestor de recaudo (USUARIOS_ROLES con rol RECAUDO_ASIST o RECAUDOS_JEFE). Sin este permiso el botón no aparece y el campo es de solo lectura',
  },
  {
    code: PersonPermission.CAMBIO_ESTADO_CARTERA,
    module: Module.PERSON,
    section: 'Financiera',
    name: 'Botón "Cambio Estado Cartera"',
    description: 'Botón en la pestaña Financiera del titular para cambiar el tipo de cartera (Normal / Prejuridico / Ultimo Pago / Penalidad). Pide motivo obligatorio y deja registro de auditoría en PAGOS_TITULARES.tipoCarteraHistory (JSONB) de la fila cuota#0. Sin este permiso el botón no aparece',
  },
  {
    code: PersonPermission.MARCAR_OPCIONAL,
    module: Module.PERSON,
    section: 'Financiera',
    name: 'Botón "Opcional"',
    description: 'Botón en la pestaña Financiera del titular que activa/desactiva la marca "OPC" (PEOPLE.marcaOpcional). Esa marca se visualiza en la columna Opcional de /dashboard/recaudos/asignacion. Toggle simple sin motivo ni auditoría — alimentación 100% manual por el equipo de recaudo. Sin este permiso el botón no aparece',
  },
  {
    code: PersonPermission.PAGOS_VER,
    module: Module.PERSON,
    section: 'Financiera',
    name: 'Sección "Pagos del Titular"',
    description: 'Visualizar la lista de pagos registrados en PAGOS_TITULARES para el titular. Sin este permiso la sección no aparece',
  },
  {
    code: PersonPermission.PAGOS_REGISTRAR,
    module: Module.PERSON,
    section: 'Financiera',
    name: 'Botón "Registrar Pago"',
    description: 'Wizard de un solo paso para registrar un nuevo pago en PAGOS_TITULARES (fechaPago, valorPagado, descuento, medioPago, número referencia, número factura, documentación, etc.). Soporta auto-guardado en localStorage (TTL 72h)',
  },
  {
    code: PersonPermission.PAGOS_VALIDAR,
    module: Module.PERSON,
    section: 'Financiera',
    name: 'Botón "Validar Pago"',
    description: 'Marcar un pago como validado (validado=true, fechaValidacion=hoy, validadoPor=usuario actual). Una vez validado el pago se considera final',
  },
  {
    code: PersonPermission.PAGOS_ELIMINAR,
    module: Module.PERSON,
    section: 'Financiera',
    name: 'Botón "Eliminar Pago"',
    description: 'Borrar un registro de PAGOS_TITULARES. Acción irreversible — bloqueada cuando el pago ya está validado',
  },
  {
    code: PersonPermission.PAGOS_RECIBO,
    module: Module.PERSON,
    section: 'Financiera',
    name: 'Botón "Generar Recibo de Pago"',
    description: 'Genera y descarga el PDF del recibo de un pago validado (formato LGS-#### con numeración consecutiva automática). Solo aparece cuando el pago ya está validado',
  },
  {
    code: PersonPermission.VER_DOCUMENTACION,
    module: Module.PERSON,
    section: 'Información General',
    name: 'Sección "Documentación"',
    description: 'Visualizar la documentación adjunta del titular',
  },
  {
    code: PersonPermission.ADICION_DOCUMENTACION,
    module: Module.PERSON,
    section: 'Información General',
    name: 'Botón "Agregar Documentación"',
    description: 'Subir nueva documentación al perfil del titular',
  },
  {
    code: PersonPermission.ACTIVAR_DESACTIVAR,
    module: Module.PERSON,
    section: 'Administración',
    name: 'Toggle "Activar/Desactivar"',
    description: 'Activar o desactivar el perfil del titular',
  },
  {
    code: PersonPermission.CAMBIO_CELULAR,
    module: Module.PERSON,
    section: 'Contacto',
    name: 'Editar "Celular Titular"',
    description: 'Modificar el número de celular del titular',
  },
  {
    code: PersonPermission.CAMBIAR_ESTADO,
    module: Module.PERSON,
    section: 'Administración',
    name: 'Dropdown "Estado Actual"',
    description: 'Cambiar estado: Aprobado, Contrato nulo, Devuelto, Pendiente, Rechazado',
  },
  {
    code: PersonPermission.APROBAR,
    module: Module.PERSON,
    section: 'Administración',
    name: 'Botón "Aprobar Beneficiario"',
    description: 'Aprobar un beneficiario (activa cuenta + envía WhatsApp)',
  },
  {
    code: PersonPermission.MODIFICAR,
    module: Module.PERSON,
    section: 'Información General',
    name: 'Botón "Editar" campos',
    description: 'Editar campos del perfil del titular (nombres, ID, etc.)',
  },
  {
    code: PersonPermission.ELIMINAR,
    module: Module.PERSON,
    section: 'Administración',
    name: 'Botón "Eliminar Beneficiario"',
    description: 'Eliminar un beneficiario del contrato',
  },
  {
    code: PersonPermission.AGREGAR_BENEFICIARIO,
    module: Module.PERSON,
    section: 'Administración',
    name: 'Botón "Agregar Beneficiario"',
    description: 'Formulario para añadir nuevo beneficiario al contrato',
  },
  {
    code: PersonPermission.WHATSAPP,
    module: Module.PERSON,
    section: 'Contacto',
    name: 'Botón "WhatsApp"',
    description: 'Enviar mensaje o abrir chat de WhatsApp con el titular',
  },

  // ========== STUDENT MODULE (Página: /student/[id]) ==========
  // -- Global --
  {
    code: StudentPermission.CONSULTA_CONTRATO,
    module: Module.STUDENT,
    section: 'Global',
    name: 'Acceso "Consulta Contrato"',
    description: 'Permite consultar datos del contrato desde el detalle del estudiante',
  },
  {
    code: StudentPermission.GENERAR_ESTADO_CUENTA,
    module: Module.STUDENT,
    section: 'Global',
    name: 'Acceso "Estado de Cuenta"',
    description: 'Permite generar el estado de cuenta desde el detalle del estudiante',
  },

  // -- Tab: General --
  {
    code: StudentPermission.ENVIAR_MENSAJE,
    module: Module.STUDENT,
    section: 'Tab General',
    name: 'Botón "Enviar Mensaje WhatsApp"',
    description: 'Enviar mensaje WhatsApp al estudiante (plantillas y personalizado)',
  },
  {
    code: StudentPermission.GUARDAR_PLANTILLA,
    module: Module.STUDENT,
    section: 'Tab General',
    name: 'Botón "Guardar como Plantilla"',
    description: 'Guardar un mensaje personalizado como plantilla reutilizable',
  },

  // -- Tab: Académica --
  {
    code: StudentPermission.TABLA_FILTROS,
    module: Module.STUDENT,
    section: 'Tab Académica > Tabla Asistencia',
    name: 'Filtros de la tabla',
    description: 'Filtrar tabla de asistencia por fecha, estado, advisor',
  },
  {
    code: StudentPermission.TABLA_DESCARGAR,
    module: Module.STUDENT,
    section: 'Tab Académica > Tabla Asistencia',
    name: 'Botón "Descargar"',
    description: 'Descargar tabla de asistencia como CSV',
  },
  {
    code: StudentPermission.COMO_VOY,
    module: Module.STUDENT,
    section: 'Tab Académica > Progreso',
    name: 'Sección "¿Cómo voy?"',
    description: 'Ver diagnóstico con barra de progreso, steps completados y porcentaje',
  },
  {
    code: StudentPermission.EVALUACION,
    module: Module.STUDENT,
    section: 'Tab Académica > Modal Clase',
    name: 'Sección "Evaluación"',
    description: 'Toggle asistencia, participación y calificación 0-10 en modal de clase',
  },
  {
    code: StudentPermission.ANOTACION_ADVISOR,
    module: Module.STUDENT,
    section: 'Tab Académica > Modal Clase',
    name: 'Sección "Anotación del Advisor"',
    description: 'Campo de texto para observaciones del advisor en modal de clase',
  },
  {
    code: StudentPermission.COMENTARIOS_ESTUDIANTE,
    module: Module.STUDENT,
    section: 'Tab Académica > Modal Clase',
    name: 'Sección "Comentarios Estudiante"',
    description: 'Comentarios visibles para el estudiante en modal de clase',
  },
  {
    code: StudentPermission.ELIMINAR_EVENTO,
    module: Module.STUDENT,
    section: 'Tab Académica > Modal Clase',
    name: 'Botón "Eliminar Evento"',
    description: 'Eliminar el evento desde el modal de detalles de clase',
  },
  {
    code: StudentPermission.AGENDAR_CLASE,
    module: Module.STUDENT,
    section: 'Tab Académica',
    name: 'Botón "Agendar Nueva Clase"',
    description: 'Wizard para agendar clase: tipo → día → hora',
  },
  {
    code: StudentPermission.MARCAR_STEP,
    module: Module.STUDENT,
    section: 'Tab Académica > Gestión Steps',
    name: 'Toggles "Marcar Step"',
    description: 'Marcar/desmarcar un step como completado (override manual)',
  },
  {
    code: StudentPermission.ASIGNAR_STEP,
    module: Module.STUDENT,
    section: 'Tab Académica > Gestión Steps',
    name: 'Botón "Cambiar Step"',
    description: 'Modal para asignar nuevo step/nivel al estudiante',
  },
  {
    code: StudentPermission.INICIALIZAR_NIVEL,
    module: Module.STUDENT,
    section: 'Tab Académica > Gestión Steps',
    name: 'Botón "Reiniciar Nivel"',
    description: 'Reinicia al estudiante al primer step de su nivel actual y borra el historial de bookings del nivel. Solo se puede realizar una vez por estudiante.',
  },

  // -- Tab: Contrato --
  {
    code: StudentPermission.CONSULTA,
    module: Module.STUDENT,
    section: 'Tab Contrato',
    name: 'Sección "Información del Contrato"',
    description: 'Ver fechas, estado y vigencia del contrato (con semáforo)',
  },
  {
    code: StudentPermission.ACTIVAR_HOLD,
    module: Module.STUDENT,
    section: 'Tab Contrato',
    name: 'Botón "Activar/Desactivar OnHold"',
    description: 'Pausar contrato con date pickers y reactivar con extensión automática',
  },
  {
    code: StudentPermission.EXTENDER_VIGENCIA,
    module: Module.STUDENT,
    section: 'Tab Contrato',
    name: 'Botón "Extender Vigencia"',
    description: 'Extender manualmente la fecha de fin del contrato',
  },

  // -- Tab: Financiera --
  {
    code: StudentPermission.GENERAR_ESTADO,
    module: Module.STUDENT,
    section: 'Tab Financiera',
    name: 'Botón "Generar Estado de Cuenta"',
    description: 'Generar resumen financiero del estudiante',
  },
  {
    code: StudentPermission.REGISTRAR_PAGO,
    module: Module.STUDENT,
    section: 'Tab Financiera',
    name: 'Botón "Registrar Pago"',
    description: 'Registrar un nuevo pago del estudiante',
  },
  {
    code: StudentPermission.ENVIO_RECORDATORIO,
    module: Module.STUDENT,
    section: 'Tab Financiera',
    name: 'Botón "Enviar Recordatorio"',
    description: 'Enviar recordatorio de pago por WhatsApp',
  },

  // ========== ACADEMICO MODULE ==========
  // -- Página: Agenda Sesiones (/dashboard/academic/agenda-sesiones) --
  {
    code: AcademicoPermission.VER_CALENDARIO,
    module: Module.ACADEMICO,
    section: 'Agenda Sesiones',
    name: 'Acceso "Calendario" (legacy)',
    description: 'Permiso legacy para ver el calendario de sesiones',
  },
  {
    code: AcademicoPermission.VER_AGENDA,
    module: Module.ACADEMICO,
    section: 'Agenda Sesiones',
    name: 'Acceso "Agenda" (legacy)',
    description: 'Permiso legacy para ver la agenda de sesiones',
  },
  {
    code: AcademicoPermission.CALENDARIO_VER,
    module: Module.ACADEMICO,
    section: 'Agenda Sesiones',
    name: 'Página "Agenda Sesiones"',
    description: 'Acceso a la vista de calendario mensual de sesiones',
  },
  {
    code: AcademicoPermission.LISTA_VER,
    module: Module.ACADEMICO,
    section: 'Agenda Sesiones',
    name: 'Vista "Lista de Eventos"',
    description: 'Ver eventos en formato lista (agenda diaria)',
  },
  {
    code: AcademicoPermission.FILTRO,
    module: Module.ACADEMICO,
    section: 'Agenda Sesiones',
    name: 'Panel "Filtros"',
    description: 'Filtrar por advisor, tipo, nivel, step, rango de fechas',
  },
  {
    code: AcademicoPermission.NUEVO_EVENTO,
    module: Module.ACADEMICO,
    section: 'Agenda Sesiones',
    name: 'Botón "Nuevo Evento"',
    description: 'Abrir formulario para crear SESSION o CLUB',
  },
  {
    code: AcademicoPermission.EXPORTAR_CSV,
    module: Module.ACADEMICO,
    section: 'Agenda Sesiones',
    name: 'Botón "Exportar CSV"',
    description: 'Descargar eventos filtrados como archivo Excel/CSV',
  },
  {
    code: AcademicoPermission.EDITAR,
    module: Module.ACADEMICO,
    section: 'Agenda Sesiones',
    name: 'Botón "Editar Evento"',
    description: 'Editar un evento existente en el calendario',
  },
  {
    code: AcademicoPermission.CREAR_EVENTO,
    module: Module.ACADEMICO,
    section: 'Agenda Sesiones',
    name: 'Acción "Crear Evento" (global)',
    description: 'Permiso general para crear eventos desde cualquier vista',
  },
  {
    code: AcademicoPermission.ELIMINAR,
    module: Module.ACADEMICO,
    section: 'Agenda Sesiones',
    name: 'Botón "Eliminar Evento"',
    description: 'Eliminar un evento del calendario',
  },
  {
    code: AcademicoPermission.VER_AGENDA_ACADEMICA,
    module: Module.ACADEMICO,
    section: 'Agenda Sesiones',
    name: 'Acceso "Agenda Académica" (legacy)',
    description: 'Permiso legacy para acceder a la agenda académica',
  },

  // -- Página: Sesión Detalle (/sesion/[id]) --
  {
    code: AcademicoPermission.IR_A_SESION,
    module: Module.ACADEMICO,
    section: 'Detalle Sesión',
    name: 'Página "Ir a la Sesión"',
    description: 'Acceso a /sesion/[id]: tomar asistencia, evaluar, comentarios',
  },

  // -- Página: Agenda Académica (/dashboard/academic/agenda-academica) --
  {
    code: AcademicoPermission.VER,
    module: Module.ACADEMICO,
    section: 'Agenda Académica',
    name: 'Página "Agenda Académica"',
    description: 'Acceso a la vista semanal de clases',
  },
  {
    code: AcademicoPermission.AGENDAMIENTO,
    module: Module.ACADEMICO,
    section: 'Agenda Académica',
    name: 'Acción "Agendamiento"',
    description: 'Gestionar el agendamiento desde agenda académica',
  },
  {
    code: AcademicoPermission.ACADEMICA_EXPORTAR_CSV,
    module: Module.ACADEMICO,
    section: 'Agenda Académica',
    name: 'Botón "Exportar CSV"',
    description: 'Descargar agenda académica como archivo Excel/CSV',
  },
  {
    code: AcademicoPermission.ESTADISTICAS,
    module: Module.ACADEMICO,
    section: 'Agenda Académica',
    name: 'Sección "Estadísticas"',
    description: 'Ver estadísticas académicas (asistencia, rendimiento)',
  },
  {
    code: AcademicoPermission.EXPORTAR_STATS_CSV,
    module: Module.ACADEMICO,
    section: 'Agenda Académica',
    name: 'Botón "Exportar Estadísticas CSV"',
    description: 'Descargar estadísticas académicas como CSV',
  },

  // -- Página: Advisors (/dashboard/academic/advisors) --
  {
    code: AcademicoPermission.LISTA_ADVISORS_VER,
    module: Module.ACADEMICO,
    section: 'Advisors',
    name: 'Página "Lista de Advisors"',
    description: 'Acceso a /dashboard/academic/advisors con lista de profesores',
  },
  {
    code: AcademicoPermission.ADVISOR_VER_ENLACE,
    module: Module.ACADEMICO,
    section: 'Advisors',
    name: 'Botón "Panel Advisor"',
    description: 'Link para abrir el panel personal del advisor',
  },
  {
    code: AcademicoPermission.AGREGAR,
    module: Module.ACADEMICO,
    section: 'Advisors',
    name: 'Botón "Agregar Advisor"',
    description: 'Crear nuevo advisor en el sistema',
  },
  {
    code: AcademicoPermission.ESTADISTICA,
    module: Module.ACADEMICO,
    section: 'Advisors',
    name: 'Columna "Estadísticas"',
    description: 'Ver estadísticas de rendimiento por advisor',
  },

  // -- Página: Actualizar Material (/dashboard/academic/actualizar-material) --
  {
    code: AcademicoPermission.ACTUALIZAR_MATERIAL,
    module: Module.ACADEMICO,
    section: 'Actualizar Material',
    name: 'Página "Actualizar Material"',
    description: 'Gestionar material de Usuarios (materialUsuario) y Advisors (material) por nivel/step — incluye subir, reemplazar, borrar y descargar archivos',
  },
  {
    code: AcademicoPermission.CONTROL_HORAS_VER,
    module: Module.ACADEMICO,
    section: 'Control Horas',
    name: 'Página "Control Horas"',
    description: 'Acceso a /dashboard/academic/control-horas. Cada advisor ve sus propias horas.',
  },
  {
    code: AcademicoPermission.CONTROL_HORAS_VER_TODOS,
    module: Module.ACADEMICO,
    section: 'Control Horas',
    name: 'Selector de Advisor en Control Horas',
    description: 'Habilita el dropdown para seleccionar/consultar el Control de Horas de CUALQUIER advisor (no sólo el propio). Sin este permiso el usuario sólo ve su propia info. SUPER_ADMIN/ADMIN lo tienen implícito.',
  },
  {
    code: AcademicoPermission.JUMP_EVAL_REVISAR,
    module: Module.ACADEMICO,
    section: 'Evaluaciones Jump',
    name: 'Revisar Evaluaciones Jump (Bot Tutor)',
    description: 'Acceso a /dashboard/academic/jump-evaluaciones. Permite revisar los reportes del bot tutor del examen Jump y aprobar/rechazar (al aprobar se crea el booking del Jump y avanza el step).',
  },
  {
    code: AcademicoPermission.PERFORMANCE_EVAL_VER,
    module: Module.ACADEMICO,
    section: 'Performance Evaluation',
    name: 'Ver Dashboard Performance Evaluation',
    description: 'Acceso a /dashboard/academic/performance-evaluation. KPIs, ranking Top 5 / Bottom 5 advisors, distribución de calificaciones, evolución mensual y tabla de comentarios. Pensado para roles COORDINADOR_ACADEMICO / ACADEMICO_JEFE. Sujeto al feature flag global performance_eval_mode (off / beta / on).',
  },
  {
    code: AcademicoPermission.PERFORMANCE_EVAL_EXPORTAR,
    module: Module.ACADEMICO,
    section: 'Performance Evaluation',
    name: '↳ Descargar CSV (Performance Evaluation)',
    description: 'Botón Exportar CSV del informe Performance Evaluation.',
  },
  {
    code: AcademicoPermission.SESIONES_SIN_GESTION_VER,
    module: Module.ACADEMICO,
    section: 'Sesiones sin gestión',
    name: 'Página "Sesiones sin gestión"',
    description: 'Acceso a /dashboard/academic/sesiones-sin-gestion. Lista de eventos pasados sin registrar (sesionCerrada=false) con filtros por fecha y advisor. Muestra inscritos/asistencia marcada para detectar si el advisor empezó pero no cerró, y un acceso directo al panel del evento para que el coordinador gestione el cierre.',
  },

  // ========== INFORMES MODULE ==========
  // Abuelo: muestra el grupo Informes en el sidebar. Cada informe se habilita
  // marcando ADEMÁS su ítem en la sección correspondiente. Las secciones
  // (Asistencia, Programación, …) aparecen solas cuando hay ≥1 ítem permitido.
  // Los filtros NO requieren permiso (implícitos al autorizar el informe).
  {
    code: InformesPermission.VER,
    module: Module.INFORMES,
    section: 'Acceso',
    name: 'Acceso a Informes (grupo)',
    description: 'Muestra el grupo "Informes" en el sidebar. Por sí solo no habilita ningún informe: marca además el ítem del informe en su sección.',
  },

  // -- Sección: Asistencia (cada informe con su botón CSV debajo) --
  { code: InformesPermission.ASIS_SESIONES,        module: Module.INFORMES, section: 'Asistencia', name: 'Informe "Sesiones"',                    description: 'Ver el informe Asistencia → Sesiones' },
  { code: InformesPermission.ASIS_SESIONES_EXP,    module: Module.INFORMES, section: 'Asistencia', name: '↳ Descargar CSV (Sesiones)',            description: 'Botón Exportar CSV del informe Asistencia → Sesiones' },
  { code: InformesPermission.ASIS_CLUBES,          module: Module.INFORMES, section: 'Asistencia', name: 'Informe "Clubes"',                      description: 'Ver el informe Asistencia → Clubes' },
  { code: InformesPermission.ASIS_CLUBES_EXP,      module: Module.INFORMES, section: 'Asistencia', name: '↳ Descargar CSV (Clubes)',              description: 'Botón Exportar CSV del informe Asistencia → Clubes' },
  { code: InformesPermission.ASIS_COMPLEMENTARIAS,     module: Module.INFORMES, section: 'Asistencia', name: 'Informe "Actividades Complementarias"', description: 'Ver el informe Asistencia → Actividades Complementarias' },
  { code: InformesPermission.ASIS_COMPLEMENTARIAS_EXP, module: Module.INFORMES, section: 'Asistencia', name: '↳ Descargar CSV (Complementarias)',     description: 'Botón Exportar CSV del informe Asistencia → Actividades Complementarias' },
  { code: InformesPermission.ASIS_WELCOME,         module: Module.INFORMES, section: 'Asistencia', name: 'Informe "Welcome Session"',             description: 'Ver el informe Asistencia → Welcome Session' },
  { code: InformesPermission.ASIS_WELCOME_EXP,     module: Module.INFORMES, section: 'Asistencia', name: '↳ Descargar CSV (Welcome Session)',     description: 'Botón Exportar CSV del informe Asistencia → Welcome Session' },
  { code: InformesPermission.ASIS_XPAIS,           module: Module.INFORMES, section: 'Asistencia', name: 'Informe "X País"',                      description: 'Ver el informe Asistencia → X País' },
  { code: InformesPermission.ASIS_XPAIS_EXP,       module: Module.INFORMES, section: 'Asistencia', name: '↳ Descargar CSV (X País)',              description: 'Botón Exportar CSV del informe Asistencia → X País' },

  // -- Sección: Programación --
  { code: InformesPermission.PROG_SESIONES_JUMPS,     module: Module.INFORMES, section: 'Programación', name: 'Informe "Sesiones - Jumps"',         description: 'Ver el informe Programación → Sesiones - Jumps' },
  { code: InformesPermission.PROG_SESIONES_JUMPS_EXP, module: Module.INFORMES, section: 'Programación', name: '↳ Descargar CSV (Sesiones - Jumps)',  description: 'Botón Exportar CSV del informe Programación → Sesiones - Jumps' },
  { code: InformesPermission.PROG_TRAINING_CLUBS,     module: Module.INFORMES, section: 'Programación', name: 'Informe "Training - Clubs"',         description: 'Ver el informe Programación → Training - Clubs' },
  { code: InformesPermission.PROG_TRAINING_CLUBS_EXP, module: Module.INFORMES, section: 'Programación', name: '↳ Descargar CSV (Training - Clubs)',  description: 'Botón Exportar CSV del informe Programación → Training - Clubs' },
  { code: InformesPermission.PROG_WELCOME,            module: Module.INFORMES, section: 'Programación', name: 'Informe "Welcome"',                  description: 'Ver el informe Programación → Welcome' },
  { code: InformesPermission.PROG_WELCOME_EXP,        module: Module.INFORMES, section: 'Programación', name: '↳ Descargar CSV (Welcome)',           description: 'Botón Exportar CSV del informe Programación → Welcome' },

  // -- Sección: Advisors --
  { code: InformesPermission.ADV_SESIONES,      module: Module.INFORMES, section: 'Advisors', name: 'Informe "Sesiones"',     description: 'Ver el informe Advisors → Sesiones' },
  { code: InformesPermission.ADV_SESIONES_EXP,  module: Module.INFORMES, section: 'Advisors', name: '↳ Descargar CSV (Sesiones)',   description: 'Botón Exportar CSV del informe Advisors → Sesiones' },
  { code: InformesPermission.ADV_JUMPS,         module: Module.INFORMES, section: 'Advisors', name: 'Informe "Jumps"',        description: 'Ver el informe Advisors → Jumps' },
  { code: InformesPermission.ADV_JUMPS_EXP,     module: Module.INFORMES, section: 'Advisors', name: '↳ Descargar CSV (Jumps)',      description: 'Botón Exportar CSV del informe Advisors → Jumps' },
  { code: InformesPermission.ADV_TRAINING,      module: Module.INFORMES, section: 'Advisors', name: 'Informe "Training"',     description: 'Ver el informe Advisors → Training' },
  { code: InformesPermission.ADV_TRAINING_EXP,  module: Module.INFORMES, section: 'Advisors', name: '↳ Descargar CSV (Training)',   description: 'Botón Exportar CSV del informe Advisors → Training' },
  { code: InformesPermission.ADV_CLUBES,        module: Module.INFORMES, section: 'Advisors', name: 'Informe "Clubes"',       description: 'Ver el informe Advisors → Clubes' },
  { code: InformesPermission.ADV_CLUBES_EXP,    module: Module.INFORMES, section: 'Advisors', name: '↳ Descargar CSV (Clubes)',     description: 'Botón Exportar CSV del informe Advisors → Clubes' },
  { code: InformesPermission.ADV_WELCOME,       module: Module.INFORMES, section: 'Advisors', name: 'Informe "Welcome"',      description: 'Ver el informe Advisors → Welcome' },
  { code: InformesPermission.ADV_WELCOME_EXP,   module: Module.INFORMES, section: 'Advisors', name: '↳ Descargar CSV (Welcome)',    description: 'Botón Exportar CSV del informe Advisors → Welcome' },
  { code: InformesPermission.ADV_ESSENTIAL,     module: Module.INFORMES, section: 'Advisors', name: 'Informe "Essential"',    description: 'Ver el informe Advisors → Essential' },
  { code: InformesPermission.ADV_ESSENTIAL_EXP, module: Module.INFORMES, section: 'Advisors', name: '↳ Descargar CSV (Essential)',  description: 'Botón Exportar CSV del informe Advisors → Essential' },
  { code: InformesPermission.ADV_RESUMEN,       module: Module.INFORMES, section: 'Advisors', name: 'Informe "Resumen"',      description: 'Ver el informe Advisors → Resumen' },
  { code: InformesPermission.ADV_RESUMEN_EXP,   module: Module.INFORMES, section: 'Advisors', name: '↳ Descargar CSV (Resumen)',    description: 'Botón Exportar CSV del informe Advisors → Resumen' },

  // -- Sección: Académica --
  { code: InformesPermission.ACAD_HORAS_ADVISOR,     module: Module.INFORMES, section: 'Académica', name: 'Informe "Horas Advisor"',        description: 'Ver el informe Académica → Horas Advisor (conducted/suspended/cancelled por advisor)' },
  { code: InformesPermission.ACAD_HORAS_ADVISOR_EXP, module: Module.INFORMES, section: 'Académica', name: '↳ Descargar CSV (Horas Advisor)', description: 'Botón Exportar CSV del informe Académica → Horas Advisor' },
  { code: InformesPermission.USUARIOS,               module: Module.INFORMES, section: 'Académica', name: 'Informe "Usuarios"',             description: 'Ver el informe Académica → Usuarios (asistencia por usuario)' },
  { code: InformesPermission.ACAD_USUARIOS_EXP,      module: Module.INFORMES, section: 'Académica', name: '↳ Descargar CSV (Usuarios)',      description: 'Botón Exportar CSV del informe Académica → Usuarios' },
  { code: InformesPermission.ACAD_INFOACADEMIC,      module: Module.INFORMES, section: 'Académica', name: 'Informe "InfoAcademic User"',     description: 'Ver el informe Académica → InfoAcademic User (reporte ejecutivo)' },
  { code: InformesPermission.ACAD_HOLD_VIGENCIAS,    module: Module.INFORMES, section: 'Académica', name: 'Informe "Hold & Vigencias"',      description: 'Ver el monitoreo del cron: desbloqueos por OnHold vencido, bloqueos por contrato vencido e inconsistencias (no procesados) con su causa' },
  { code: InformesPermission.ACAD_HOLD_VIGENCIAS_EXP, module: Module.INFORMES, section: 'Académica', name: '↳ Descargar CSV (Hold & Vigencias)', description: 'Botón Exportar CSV del informe Académica → Hold & Vigencias' },
  { code: InformesPermission.ACAD_X_NIVELES,         module: Module.INFORMES, section: 'Académica', name: 'Informe "X Niveles"',             description: 'Ver el listado de usuarios académicos por nivel (BN1…DONE o todos) con filtros de fecha, conteo y exportación CSV' },
  { code: InformesPermission.ACAD_X_NIVELES_EXP,     module: Module.INFORMES, section: 'Académica', name: '↳ Descargar CSV (X Niveles)',      description: 'Botón Exportar CSV del informe Académica → X Niveles' },
  { code: InformesPermission.ACAD_CONCILIACION_STEPS,     module: Module.INFORMES, section: 'Académica', name: 'Informe "Conciliación Steps"',     description: 'Ver el monitoreo del cron reconcile-pegados: salud del job nocturno, pegados limpios pendientes (con causa inferida), pegados con flags para revisión manual y acciones del rango' },
  { code: InformesPermission.ACAD_CONCILIACION_STEPS_EXP, module: Module.INFORMES, section: 'Académica', name: '↳ Descargar CSV (Conciliación Steps)', description: 'Botón Exportar CSV del informe Académica → Conciliación Steps' },
  { code: InformesPermission.ACAD_POR_VENCER,             module: Module.INFORMES, section: 'Académica', name: 'Informe "Por Vencer"',               description: 'Listado de contratos con finalContrato dentro de un rango (hoy → hoy+1mes por defecto), con toggle Titulares / Beneficiarios. En modo Beneficiario muestra contadores históricos de Hold y Extensión + filtros por ambos. Botón "Ver" navega a /person (titular) o /student (beneficiario)' },
  { code: InformesPermission.ACAD_POR_VENCER_EXP,         module: Module.INFORMES, section: 'Académica', name: '↳ Descargar CSV (Por Vencer)',        description: 'Botón Exportar CSV del informe Académica → Por Vencer' },
  { code: InformesPermission.ACAD_INFOACADEMIC_EXP,  module: Module.INFORMES, section: 'Académica', name: '↳ Descargar CSV (InfoAcademic)',  description: 'Botón Exportar CSV del informe Académica → InfoAcademic User' },
  { code: InformesPermission.ACAD_INFOACADEMIC_PDF,  module: Module.INFORMES, section: 'Académica', name: '↳ Imprimir / PDF (InfoAcademic)', description: 'Botón Imprimir / generar PDF del informe Académica → InfoAcademic User' },

  // -- Sección: Contratos --
  { code: InformesPermission.CONTRATOS, module: Module.INFORMES, section: 'Contratos', name: 'Informe "Contratos"', description: 'Ver el informe de Contratos (placeholder)' },
  { code: InformesPermission.CONTRATOS_MATRICULAS,     module: Module.INFORMES, section: 'Contratos', name: 'Informe "Matrículas"', description: 'Ver el informe Contratos → Matrículas (por aprobar / vigentes / finalizados, académicos, barras, dona y heatmap por país)' },
  { code: InformesPermission.CONTRATOS_MATRICULAS_EXP, module: Module.INFORMES, section: 'Contratos', name: '↳ Descargar CSV (Matrículas)', description: 'Botón Exportar CSV del informe Contratos → Matrículas' },
  { code: InformesPermission.CONTRATOS_MATRICULAS_PDF, module: Module.INFORMES, section: 'Contratos', name: '↳ Imprimir / PDF (Matrículas)', description: 'Botón Imprimir / generar PDF del informe Contratos → Matrículas' },

  // -- Sección: Planta --
  { code: InformesPermission.PLANTA_ADVISORS,        module: Module.INFORMES, section: 'Planta', name: 'Informe "Advisors" (Planta)',        description: 'Ver el informe Planta → Advisors' },
  { code: InformesPermission.PLANTA_ADMINISTRATIVOS, module: Module.INFORMES, section: 'Planta', name: 'Informe "Administrativos" (Planta)', description: 'Ver el informe Planta → Administrativos' },

  // -- Sección: Estadísticas --
  { code: InformesPermission.EST_NIVELES,      module: Module.INFORMES, section: 'Estadísticas', name: 'Informe "Niveles"',        description: 'Ver el informe Estadísticas → Niveles' },
  { code: InformesPermission.EST_NIVELES_EXP,  module: Module.INFORMES, section: 'Estadísticas', name: '↳ Descargar CSV (Niveles)', description: 'Botón Exportar CSV del informe Estadísticas → Niveles' },
  { code: InformesPermission.EST_HORARIOS,     module: Module.INFORMES, section: 'Estadísticas', name: 'Informe "Horarios"',       description: 'Ver el informe Estadísticas → Horarios' },
  { code: InformesPermission.EST_HORARIOS_EXP, module: Module.INFORMES, section: 'Estadísticas', name: '↳ Descargar CSV (Horarios)',description: 'Botón Exportar CSV del informe Estadísticas → Horarios' },

  // ========== SERVICIO MODULE ==========
  // -- Página: Welcome Session (/dashboard/servicio/welcome-session) --
  {
    code: ServicioPermission.WELCOME_CARGAR_EVENTOS,
    module: Module.SERVICIO,
    section: 'Welcome Session',
    name: 'Página "Welcome Session"',
    description: 'Acceso a carga y gestión de eventos de bienvenida',
  },
  {
    code: ServicioPermission.WELCOME_EXPORTAR_CSV,
    module: Module.SERVICIO,
    section: 'Welcome Session',
    name: 'Botón "Exportar CSV"',
    description: 'Descargar welcome sessions como archivo Excel/CSV',
  },

  // -- Página: Lista Sesiones (/dashboard/servicio/lista-sesiones) --
  {
    code: ServicioPermission.SESIONES_CARGAR_EVENTOS,
    module: Module.SERVICIO,
    section: 'Lista Sesiones',
    name: 'Página "Lista de Sesiones"',
    description: 'Acceso a lista de sesiones con filtros por fecha y estado',
  },
  {
    code: ServicioPermission.SESIONES_EXPORTAR_CSV,
    module: Module.SERVICIO,
    section: 'Lista Sesiones',
    name: 'Botón "Exportar CSV"',
    description: 'Descargar lista de sesiones como archivo Excel/CSV',
  },

  // -- Página: Sin Registro (/dashboard/servicio/sin-registro) --
  {
    code: ServicioPermission.USUARIOS_ACTUALIZAR,
    module: Module.SERVICIO,
    section: 'Usuarios Sin Registro',
    name: 'Página "Sin Registro"',
    description: 'Ver y gestionar beneficiarios sin perfil académico',
  },
  {
    code: ServicioPermission.USUARIOS_EXPORTAR_CSV,
    module: Module.SERVICIO,
    section: 'Usuarios Sin Registro',
    name: 'Botón "Exportar CSV"',
    description: 'Descargar usuarios sin registro como archivo Excel/CSV',
  },

  // -- Página: Exam. Intern. > IELTS (/dashboard/servicio/exam-intern/ielts) --
  {
    code: ServicioPermission.EXAM_INTERN_IELTS_VER,
    module: Module.SERVICIO,
    section: 'Exam. Intern. > IELTS',
    name: 'Página "IELTS"',
    description: 'Acceso al listado de estudiantes preparando IELTS (pruebainter=IELTS o step=Step 47)',
  },
  {
    code: ServicioPermission.EXAM_INTERN_IELTS_EXPORTAR,
    module: Module.SERVICIO,
    section: 'Exam. Intern. > IELTS',
    name: 'Botón "Exportar CSV"',
    description: 'Descargar listado IELTS como archivo CSV',
  },
  {
    code: ServicioPermission.EXAM_INTERN_IELTS_APLICAR_CONFIRMACION,
    module: Module.SERVICIO,
    section: 'Exam. Intern. > IELTS',
    name: 'Botón "Aplicar Confirmación"',
    description: 'Columna CONFIRMADO + botón rojo que extiende 100 días desde fecha base a los marcados y bloquea (DONE Step 50) a los no marcados. Acción irreversible.',
  },

  // -- Página: Exam. Intern. > B2 First (/dashboard/servicio/exam-intern/b2first) --
  {
    code: ServicioPermission.EXAM_INTERN_B2F_VER,
    module: Module.SERVICIO,
    section: 'Exam. Intern. > B2 First',
    name: 'Página "B2 First"',
    description: 'Acceso al listado de estudiantes preparando B2 First (pruebainter=B2F o step=Step 48)',
  },
  {
    code: ServicioPermission.EXAM_INTERN_B2F_EXPORTAR,
    module: Module.SERVICIO,
    section: 'Exam. Intern. > B2 First',
    name: 'Botón "Exportar CSV"',
    description: 'Descargar listado B2 First como archivo CSV',
  },
  {
    code: ServicioPermission.EXAM_INTERN_B2F_APLICAR_CONFIRMACION,
    module: Module.SERVICIO,
    section: 'Exam. Intern. > B2 First',
    name: 'Botón "Aplicar Confirmación"',
    description: 'Columna CONFIRMADO + botón rojo que extiende 100 días desde fecha base a los marcados y bloquea (DONE Step 50) a los no marcados. Acción irreversible.',
  },

  // -- Página: Exam. Intern. > TOEFL (/dashboard/servicio/exam-intern/toefl) --
  {
    code: ServicioPermission.EXAM_INTERN_TOEFL_VER,
    module: Module.SERVICIO,
    section: 'Exam. Intern. > TOEFL',
    name: 'Página "TOEFL"',
    description: 'Acceso al listado de estudiantes preparando TOEFL (pruebainter=TOEF o step=Step 49)',
  },
  {
    code: ServicioPermission.EXAM_INTERN_TOEFL_EXPORTAR,
    module: Module.SERVICIO,
    section: 'Exam. Intern. > TOEFL',
    name: 'Botón "Exportar CSV"',
    description: 'Descargar listado TOEFL como archivo CSV',
  },
  {
    code: ServicioPermission.EXAM_INTERN_TOEFL_APLICAR_CONFIRMACION,
    module: Module.SERVICIO,
    section: 'Exam. Intern. > TOEFL',
    name: 'Botón "Aplicar Confirmación"',
    description: 'Columna CONFIRMADO + botón rojo que extiende 100 días desde fecha base a los marcados y bloquea (DONE Step 50) a los no marcados. Acción irreversible.',
  },

  // ========== COMERCIAL MODULE ==========
  // -- Página: Contrato Detalle (/dashboard/comercial/contrato/[id]) --
  {
    code: ComercialPermission.MODIFICAR_CONTRATO,
    module: Module.COMERCIAL,
    section: 'Detalle Contrato',
    name: 'Edición inline del contrato',
    description: 'Editar secciones del contrato: titular, referencias, beneficiarios, financiero',
  },
  {
    code: ComercialPermission.ENVIAR_PDF,
    module: Module.COMERCIAL,
    section: 'Detalle Contrato',
    name: 'Botón "Enviar PDF por WhatsApp"',
    description: 'Generar PDF del contrato vía API2PDF y enviar por WhatsApp',
  },
  {
    code: ComercialPermission.DESCARGAR,
    module: Module.COMERCIAL,
    section: 'Detalle Contrato',
    name: 'Botón "Descargar PDF"',
    description: 'Descargar el contrato generado como PDF',
  },
  {
    code: ComercialPermission.APROBACION_AUTONOMA,
    module: Module.COMERCIAL,
    section: 'Detalle Contrato',
    name: 'Botón "Auto-aprobar Consentimiento"',
    description: 'Aprobar consentimiento declarativo sin OTP del cliente',
  },

  // -- Página: Prospectos (/dashboard/comercial/prospectos) --
  {
    code: ComercialPermission.VER_PROSPECTOS,
    module: Module.COMERCIAL,
    section: 'Prospectos',
    name: 'Página "Prospectos"',
    description: 'Acceso al pipeline comercial de prospectos',
  },

  // ========== APROBACION MODULE (/dashboard/aprobacion) ==========
  {
    code: AprobacionPermission.ACTUALIZAR,
    module: Module.APROBACION,
    section: 'Lista de Aprobaciones',
    name: 'Página "Aprobaciones"',
    description: 'Acceso a la lista de contratos pendientes de aprobación',
  },
  {
    code: AprobacionPermission.EXPORTAR_CSV,
    module: Module.APROBACION,
    section: 'Lista de Aprobaciones',
    name: 'Botón "Exportar CSV"',
    description: 'Descargar contratos pendientes como archivo Excel/CSV',
  },
  {
    code: AprobacionPermission.VER_CONTRATO,
    module: Module.APROBACION,
    section: 'Detalle Aprobación',
    name: 'Botón "Ver Contrato"',
    description: 'Abrir detalle del contrato pendiente de aprobación',
  },
  {
    code: AprobacionPermission.ENVIAR_PDF,
    module: Module.APROBACION,
    section: 'Detalle Aprobación',
    name: 'Botón "Enviar PDF"',
    description: 'Enviar contrato por WhatsApp desde vista de aprobación',
  },
  {
    code: AprobacionPermission.DESCARGAR,
    module: Module.APROBACION,
    section: 'Detalle Aprobación',
    name: 'Botón "Descargar PDF"',
    description: 'Descargar contrato pendiente como PDF',
  },
  {
    code: AprobacionPermission.APROBACION_AUTONOMA,
    module: Module.APROBACION,
    section: 'Detalle Aprobación',
    name: 'Botón "Aprobación Autónoma"',
    description: 'Aprobar contrato sin verificación OTP del cliente',
  },

  // ========== MANTENIMIENTO MODULE (Menú Mantenimiento) ==========
  {
    code: MantenimientoPermission.MIGRAR_CONTRATO,
    module: Module.MANTENIMIENTO,
    section: 'Usuarios',
    name: 'Página "Migrar Contrato"',
    description: 'Acceso a migrar contratos existentes creando titular y beneficiarios manualmente con número de contrato predefinido',
  },
  {
    code: MantenimientoPermission.BLOQUEAR_CONTRATO,
    module: Module.MANTENIMIENTO,
    section: 'Usuarios',
    name: 'Página "Bloqueo Contrato"',
    description: 'Acceso a /admin/bloqueo-contrato. Permite bloquear manualmente titular y beneficiarios de un contrato vencido. Respeta extensiones individuales de beneficiarios (no bloquea si tienen finalContrato > hoy)',
  },
  {
    code: MantenimientoPermission.CLEAR_HISTORIC,
    module: Module.MANTENIMIENTO,
    section: 'Usuarios',
    name: 'Página "Clear Historic"',
    description: 'Acceso a /admin/clear-historic. Elimina el historial académico (bookings, complementarias, step overrides) de un estudiante. Acción irreversible — solo una vez por estudiante',
  },
  {
    code: MantenimientoPermission.EDICION_CONTRATO,
    module: Module.MANTENIMIENTO,
    section: 'Usuarios',
    name: 'Página "Edición Contrato"',
    description: 'Acceso a /admin/edicion-contrato. Busca un titular por _id o número de contrato y abre la página de detalle comercial en nueva pestaña',
  },
  {
    code: MantenimientoPermission.ENVIO_MENSAJES,
    module: Module.MANTENIMIENTO,
    section: 'Usuarios',
    name: 'Página "Envío Mensajes"',
    description: 'Acceso a /admin/envio-mensajes. Envío masivo de mensajes WhatsApp a usuarios filtrados',
  },
  {
    code: MantenimientoPermission.CREAR_ROL,
    module: Module.MANTENIMIENTO,
    section: 'Usuarios',
    name: 'Página "Crear Rol"',
    description: 'Acceso a /admin/roles/create. Crea nuevos roles con sus permisos asociados',
  },
  {
    code: MantenimientoPermission.GENERAR_CONTRATO,
    module: Module.MANTENIMIENTO,
    section: 'Usuarios',
    name: 'Página "Generar Contrato"',
    description: 'Acceso a /admin/generar-contrato. Regenera el PDF del contrato y lo sube al Drive (sobreescribiendo el anterior) sin reenviar el WhatsApp al cliente. Útil cuando se detecta un error en un contrato ya generado',
  },
  {
    code: MantenimientoPermission.CONTRATOS_PRUEBA,
    module: Module.MANTENIMIENTO,
    section: 'Usuarios',
    name: 'Página "Contratos Prueba"',
    description: 'Acceso a /admin/contratos-prueba. Lista los contratos creados como prueba (prefijo PRB-) y permite purgarlos en cascada (PEOPLE + ACADEMICA + ACADEMICA_BOOKINGS + FINANCIEROS + PAGOS_TITULARES + STEP_OVERRIDES + COMPLEMENTARIA_ATTEMPTS + USUARIOS_ROLES). Cada purga deja snapshot completo en PURGE_LOG (reversible si se identifica error). Acción destructiva — recomendado SUPER_ADMIN únicamente',
  },
  {
    code: MantenimientoPermission.AVISOS_TICKER,
    module: Module.MANTENIMIENTO,
    section: 'Avisos',
    name: 'Página "Ticker"',
    description: 'Acceso a /admin/ticker. Edita el banner animado del panel estudiante',
  },
  {
    code: MantenimientoPermission.AVISOS_BANNER,
    module: Module.MANTENIMIENTO,
    section: 'Avisos',
    name: 'Página "Banner"',
    description: 'Acceso a /admin/banner. Sube/edita la imagen del banner mostrado en el login',
  },
  {
    code: MantenimientoPermission.ACTUALIZAR_VIDEOS,
    module: Module.MANTENIMIENTO,
    section: 'Material',
    name: 'Página "Actualizar Videos"',
    description: 'Acceso a /admin/actualizar-videos. Gestión de videos instructivos del panel estudiante y videos por nivel/step',
  },
  {
    code: MantenimientoPermission.PLANTILLAS_GESTION,
    module: Module.MANTENIMIENTO,
    section: 'Plantillas',
    name: 'Página "Gestión de Plantillas"',
    description: 'Acceso a /admin/plantillas/gestion. CRUD de plantillas de mensajes WhatsApp usadas en envío individual y masivo',
  },
  {
    code: MantenimientoPermission.SCRIPTS_USUARIOS_PEGADOS,
    module: Module.MANTENIMIENTO,
    section: 'Scripts',
    name: 'Página "Usuarios Pegados"',
    description: 'Acceso a /admin/scripts/usuarios-pegados. Detecta estudiantes cuyo step actual es menor al step real calculado según sus bookings y permite reconciliar en bulk',
  },
  {
    code: MantenimientoPermission.SCRIPTS_CONSULTA,
    module: Module.MANTENIMIENTO,
    section: 'Scripts',
    name: 'Página "Consulta de Scripts"',
    description: 'Acceso a /admin/scripts/consulta. Catálogo de los scripts del repositorio con su utilidad, comando de ejecución, parámetros y tipo (lectura/escritura). Buscable y exportable a CSV',
  },

  // ========== RECAUDOS MODULE (Menú Recaudos) ==========
  {
    code: RecaudosPermission.GESTION_VER,
    module: Module.RECAUDOS,
    section: 'Gestión',
    name: 'Sub-ítem "Gestión" (sidebar Recaudos)',
    description: 'Acceso al grupo Recaudos > Gestión en el sidebar. Página de gestión de pagos/recaudos (en construcción)',
  },
  {
    code: RecaudosPermission.ASIGNACION_VER,
    module: Module.RECAUDOS,
    section: 'Asignación',
    name: 'Sub-ítem "Asignación" (sidebar Recaudos)',
    description: 'Acceso a /dashboard/recaudos/asignacion — vista "Usuarios Asignados" filtrada por rol del usuario logueado (RECAUDOS_JEFE ve todos los titulares con gestor asignado; RECAUDO_ASIST ve sólo los suyos; SUPER_ADMIN/ADMIN ven todos)',
  },
  {
    code: RecaudosPermission.ASIGNACION_EXPORTAR,
    module: Module.RECAUDOS,
    section: 'Asignación',
    name: 'Botón "Exportar Excel" en Asignación',
    description: 'Permite descargar a Excel la tabla de titulares asignados. SUPER_ADMIN y ADMIN siempre pueden; otros roles requieren este permiso explícito',
  },
];

// ============================================================================
// FUNCIONES AUXILIARES
// ============================================================================

export function getPermissionsByModule(module: Module): PermissionDefinition[] {
  return PERMISSIONS_CATALOG.filter((p) => p.module === module);
}

export function getPermissionByCode(code: Permission): PermissionDefinition | undefined {
  return PERMISSIONS_CATALOG.find((p) => p.code === code);
}

export function getAllPermissionCodes(): Permission[] {
  return PERMISSIONS_CATALOG.map((p) => p.code);
}
