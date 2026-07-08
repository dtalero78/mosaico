import type { AdvisorReportType } from '@/app/api/postgres/reports/programacion/advisors/route'
import { InformesPermission, type Permission } from '@/types/permissions'
export type { AdvisorReportType }

export interface AdvisorReportConfig {
  title:              string
  subtitle:           string
  kpiLabel:           string          // "Total Sesiones" / "Total Jumps" / etc.
  rankingLabelAdv:    string          // column header without advisor: "Advisor"
  rankingLabelSec:    string          // column header with advisor: "Nivel" / "Tipo de Club"
  chartLabelSec:      string          // "por Nivel" / "por Tipo de Club"
  showNivelFilter:    boolean         // false for clubes (use tipoClub) and welcome
  showTipoClubFilter: boolean         // true only for clubes
  accentColor:        string
  exportPermission:   Permission      // permiso del botón "Exportar CSV" de ESTE informe
}

export const ADVISOR_REPORT_CONFIGS: Record<AdvisorReportType, AdvisorReportConfig> = {
  sesiones: {
    title:              'Informe de Sesiones por Advisor',
    subtitle:           'Sesiones programadas (excluye Jumps, Talleres y Welcome)',
    kpiLabel:           'Total Sesiones',
    rankingLabelAdv:    'Advisor',
    rankingLabelSec:    'Nivel',
    chartLabelSec:      'por Nivel',
    showNivelFilter:    true,
    showTipoClubFilter: false,
    accentColor:        '#3b82f6',
    exportPermission:   InformesPermission.ADV_SESIONES_EXP,
  },
  jumps: {
    title:              'Informe de Jumps por Advisor',
    subtitle:           'Jump Steps (múltiplos de 5: Step 5, 10, 15…)',
    kpiLabel:           'Total Jumps',
    rankingLabelAdv:    'Advisor',
    rankingLabelSec:    'Nivel',
    chartLabelSec:      'por Nivel',
    showNivelFilter:    true,
    showTipoClubFilter: false,
    accentColor:        '#ef4444',
    exportPermission:   InformesPermission.ADV_JUMPS_EXP,
  },
  training: {
    title:              'Informe de Training por Advisor',
    subtitle:           'Eventos CLUB tipo TRAINING (TRAINING - Step X)',
    kpiLabel:           'Total Training',
    rankingLabelAdv:    'Advisor',
    rankingLabelSec:    'Nivel',
    chartLabelSec:      'por Nivel',
    showNivelFilter:    true,
    showTipoClubFilter: false,
    accentColor:        '#f97316',
    exportPermission:   InformesPermission.ADV_TRAINING_EXP,
  },
  clubes: {
    title:              'Informe de Talleres por Advisor',
    subtitle:           'Eventos CLUB excluyendo Training (Listening, Grammar, Karaoke…)',
    kpiLabel:           'Total Talleres',
    rankingLabelAdv:    'Advisor',
    rankingLabelSec:    'Tipo de Taller',
    chartLabelSec:      'por Tipo de Taller',
    showNivelFilter:    false,
    showTipoClubFilter: true,
    accentColor:        '#22c55e',
    exportPermission:   InformesPermission.ADV_CLUBES_EXP,
  },
  welcome: {
    title:              'Informe de Welcome por Advisor',
    subtitle:           'Sesiones de bienvenida (nivel WELCOME)',
    kpiLabel:           'Total Welcome',
    rankingLabelAdv:    'Advisor',
    rankingLabelSec:    'Advisor',
    chartLabelSec:      'por Advisor',
    showNivelFilter:    false,
    showTipoClubFilter: false,
    accentColor:        '#a855f7',
    exportPermission:   InformesPermission.ADV_WELCOME_EXP,
  },
  essential: {
    title:              'Informe Essential por Advisor',
    subtitle:           'Sesiones ESS (nivel de inicio previo a BN1)',
    kpiLabel:           'Total Essential',
    rankingLabelAdv:    'Advisor',
    rankingLabelSec:    'Nivel',
    chartLabelSec:      'por Nivel',
    showNivelFilter:    false,
    showTipoClubFilter: false,
    accentColor:        '#0ea5e9',
    exportPermission:   InformesPermission.ADV_ESSENTIAL_EXP,
  },
}
