// User types
export interface User {
  _id: string
  name: string
  email: string
  role: 'admin' | 'advisor' | 'service' | 'commercial' | 'super'
  createdAt: string
  updatedAt: string
}

// Student types
export interface Student {
  _id: string
  numeroId: string
  primerNombre: string
  segundoNombre?: string
  primerApellido: string
  segundoApellido?: string
  nivel: string          // Nivel principal (WELCOME, BN1, BN2, etc.)
  step: string           // Step principal
  nivelParalelo?: string // Nivel paralelo opcional (ej: ESS)
  stepParalelo?: string  // Step paralelo opcional
  asesor?: string
  fechaNacimiento?: string
  celular?: string
  telefono?: string
  email?: string
  contrato?: string
  fechaCreacion: string
  tipoUsuario: 'BENEFICIARIO'
  plataforma?: string
  clave?: string
  claveLogin?: string
  usuarioId?: string
  peopleId?: string
  estadoInactivo?: boolean
  // Extension de vigencia fields
  fechaContrato?: string
  finalContrato?: string
  vigencia?: number
  extensionCount?: number
  extensionHistory?: ExtensionHistoryEntry[]
  // OnHold fields
  onHoldCount?: number
  onHoldHistory?: OnHoldHistoryEntry[]
  // Administrative suspension fields
  suspenddata?: SuspendDataEntry | null
  suspendcount?: number
  // Documents
  documentacion?: Array<string | { url: string; nombre: string; tipo?: string; fechaSubida?: string }>
}

// Person types
export interface Person {
  _id: string
  numeroId: string
  primerNombre: string
  segundoNombre?: string
  primerApellido: string
  segundoApellido?: string
  celular?: string
  email?: string
  domicilio?: string
  ciudad?: string
  fechaNacimiento?: string
  contrato: string
  vigencia?: string
  fechaCreacion: string
  tipoUsuario: 'TITULAR'
  plataforma?: string
  nivel?: string          // Nivel principal (opcional para titulares)
  step?: string           // Step principal (opcional para titulares)
  nivelParalelo?: string // Nivel paralelo opcional (ej: ESS)
  stepParalelo?: string  // Step paralelo opcional
  aprobacion?: 'Aprobado' | 'Pendiente' | 'Rechazado' | 'Contrato nulo' | 'Devuelto'
  estadoInactivo?: boolean
  estado?: string
  fechaOnHold?: string
  fechaFinOnHold?: string
  vigenciaOriginalPreOnHold?: string
  onHoldCount?: number
  onHoldHistory?: OnHoldHistoryEntry[]
  extensionCount?: number
  extensionHistory?: ExtensionHistoryEntry[]
  fechaContrato?: string
  finalContrato?: string
  titularId?: string
  // Consent fields
  consentimientoDeclarativo?: string
  hashConsentimiento?: string
  numeroDocumentoVerificado?: string
  inicioContrato?: string
  // Documents
  documentacion?: Array<string | { url: string; nombre: string; tipo?: string; fechaSubida?: string }>

  // Collection executive (USUARIOS_ROLES._id with rol RECAUDO_ASIST or RECAUDOS_JEFE)
  gestorRecaudo?: string | null

  // Marca manual de recaudo (alimentada vía botón "Opcional" en PersonFinancial).
  // Visualizada en columna "Opcional" de /dashboard/recaudos/asignacion.
  // Valores actuales: 'OPC' o null.
  marcaOpcional?: string | null

  // Administrative suspension fields
  suspenddata?: SuspendDataEntry | null
  suspendcount?: number
}

export interface SuspendDataEntry {
  accion: 'INACTIVACION' | 'REACTIVACION'
  motivo: string
  fecha: string
  realizadoPor: string
  realizadoPorNombre?: string
}

export interface OnHoldHistoryEntry {
  fechaOnHold: string
  fechaFinOnHold: string
  motivo: string
  activadoPor: string
  fechaActivacion: string
}

export interface ExtensionHistoryEntry {
  numero: number
  fechaEjecucion: string
  vigenciaAnterior: string
  vigenciaNueva: string
  diasExtendidos: number
  motivo?: string
}

// Class types
export interface Class {
  _id: string
  studentId: string
  eventoId: string
  tipo: 'SESSION' | 'CLUB' | 'WELCOME' | 'COMPLEMENTARIA'
  fecha: string
  hora: string
  advisor: string
  nivel: string
  step?: string
  asistencia: boolean
  participacion: boolean
  noAprobo?: boolean
  cancelo?: boolean
  calificacion?: number
  anotaciones?: string
  comentarios?: string
  linkZoom?: string
}

// Event types
export interface Event {
  _id: string
  tipo: 'SESSION' | 'CLUB' | 'WELCOME'
  fecha: string
  hora: string
  advisor: string
  nivel: string
  step?: string
  club?: string
  titulo: string
  observaciones?: string
  linkZoom?: string
  limiteUsuarios: number
  inscritos: number
}

// Step Override types
export interface StepOverride {
  _id: string
  studentId: string
  idEnAcademica: string
  academicaId: string
  nivel: string
  step: string
  isCompleted: boolean
  primerNombre: string
  primerApellido: string
  createdAt: string
}

// Financial types
export interface FinancialData {
  contrato: string
  tarifa: number
  cuotas: number
  cuotasPagadas: number
  saldo: number
  fechaUltimoPago?: string
  estado: 'Al día' | 'En mora' | 'Vencido'
  documentacion?: string[]
}

// Beneficiary types
export interface Beneficiary {
  _id: string
  numeroId: string
  nombre: string
  apellido: string
  celular?: string
  estado: 'Pendiente' | 'Aprobado' | 'ON HOLD' | 'Eliminado' | 'Inactivo'
  fechaCreacion: string
  whatsappSent?: boolean
  estadoInactivo?: boolean
  curso?: string
  salon?: string
}

// Comment types
export interface Comment {
  _id: string
  targetId: string
  targetType: 'PERSON' | 'STUDENT'
  tipo: 'Información' | 'Seguimiento' | 'Alerta' | 'Nota'
  prioridad: 'Baja' | 'Media' | 'Alta' | 'Crítica'
  comentario: string
  autor: string
  fechaCreacion: string
}

// Advisor types
export interface Advisor {
  _id: string
  nombre: string
  apellido: string
  email: string
  celular?: string
  linkZoom?: string
  activo: boolean
  especialidades: string[]
}

// Search types
export interface SearchResult {
  success: boolean
  data: {
    people: Person[]
    academica: Student[]
  }
  totalCount: number
}

// Dashboard types
export interface DashboardStats {
  totalUsuarios: number
  estudiantesActivos: number
  aprobacionesPendientes: number
  eventosHoy: number
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

// Navigation types
export interface NavItem {
  name: string
  href: string
  icon?: React.ComponentType<any>
  children?: NavItem[]
}

// Form types
export interface LoginForm {
  email: string
  password: string
}

export interface StudentForm {
  primerNombre: string
  segundoNombre?: string
  primerApellido: string
  segundoApellido?: string
  numeroId: string
  nivel: string
  step: string
  asesor?: string
  fechaNacimiento?: string
  celular?: string
  email?: string
  contrato?: string
}

export interface PersonForm {
  primerNombre: string
  segundoNombre?: string
  primerApellido: string
  segundoApellido?: string
  numeroId: string
  celular?: string
  email?: string
  domicilio?: string
  ciudad?: string
  fechaNacimiento?: string
  contrato: string
  vigencia?: string
  plataforma?: string
}

// Agenda types
export interface AgendaRow {
  advisor: string
  nombreCompleto: string
  eventos: Event[]
}

// Types are exported inline above with their definitions