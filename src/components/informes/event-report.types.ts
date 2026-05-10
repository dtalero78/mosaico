export type ReportType = 'sessions-jumps' | 'training-clubs' | 'welcome'

export interface FilterState {
  fechaInicio:   string
  fechaFin:      string
  nivel:         string
  hora:          string
  advisorNombre: string
  tipoClub:      string
}

export interface KpiData {
  totalEventos:   number
  totalPorTipo:   Record<string, number>
  totalInscritos: number
  totalAsistentes: number
  totalCapacidad: number
  pctAsistencia:  number
  pctOcupacion:   number
}

export interface ChartPoint       { name: string; total: number }
export interface TimeSeriesPoint  { fecha: string; inscritos: number; asistentes: number }
export interface HeatmapPoint     { dia: string; hora: string; total: number }

export interface ChartsData {
  // Globales (todos los reportes)
  eventosPorTipo:        ChartPoint[]
  clubsPorTipo:          ChartPoint[]
  eventosPorNivel:       ChartPoint[]
  eventosPorHora:        ChartPoint[]
  asistenciaVsInscritos: TimeSeriesPoint[]
  rankingAdvisors:       ChartPoint[]
  heatmapDiaHora:        HeatmapPoint[]

  // Split TRAINING vs CLUB (solo training-clubs)
  trainingPorNivel?:        ChartPoint[]
  trainingPorHora?:         ChartPoint[]
  trainingAsistencia?:      TimeSeriesPoint[]
  clubesPorNivel?:          ChartPoint[]
  clubesPorHora?:           ChartPoint[]
  clubesAsistencia?:        TimeSeriesPoint[]
  rankingAdvisorsTraining?: ChartPoint[]
  rankingAdvisorsClub?:     ChartPoint[]
  heatmapTraining?:         HeatmapPoint[]
  heatmapClub?:             HeatmapPoint[]
}

export interface TableRow {
  _id:          string
  dia:          string
  hora:         string | null
  tipo:         string
  tipoDerivado: string
  nivel:        string
  step:         string
  nombreEvento: string
  advisorNombre: string
  inscritos:    number
  asistentes:   number
  capacidad:    number
  pctAsistencia: number
  pctOcupacion:  number
}

export interface ReportResponse {
  kpis:   KpiData
  charts: ChartsData
  table:  TableRow[]
  meta:   { niveles: string[]; horas: string[]; advisors: string[] }
}

export interface ReportConfig {
  title:             string
  subtitle:          string
  tiposPermitidos:   string[]
  kpiLabels:         { key: string; label: string }[]
  showTipoClubFilter: boolean
  colors:            Record<string, string>
}
