'use client'

export interface RankingRow {
  posicion:         number
  nombre:           string
  totalSesiones:    number
  totalAgendados:   number
  totalAsistieron:  number
  totalNoAsistieron: number
  pctAsistencia:    number
}

interface Props {
  data:      RankingRow[]
  tipo:      'advisor' | 'nivel'
  loading:   boolean
}

export default function AdvisorScheduleRanking({ data, tipo, loading }: Props) {
  const title  = tipo === 'advisor' ? 'Ranking de Advisors por Sesiones' : 'Ranking de Niveles por Sesiones'
  const colNom = tipo === 'advisor' ? 'Advisor' : 'Nivel'

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <p className="text-xs text-gray-400 mt-0.5">{data.length} {tipo === 'advisor' ? 'advisors' : 'niveles'}</p>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2" />
          <p className="text-xs text-gray-400">Cargando...</p>
        </div>
      ) : !data.length ? (
        <div className="p-8 text-center">
          <p className="text-sm text-gray-400">Sin datos para el período seleccionado.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['#', colNom, 'Sesiones', 'Agendados', 'Asistieron', 'No Asistieron', '% Asistencia'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map(row => (
                <tr key={row.posicion} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-2.5 text-gray-400 text-xs font-medium">{row.posicion}</td>
                  <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[180px] truncate" title={row.nombre}>{row.nombre}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                      {row.totalSesiones}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-700">{row.totalAgendados}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-green-600">{row.totalAsistieron}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-red-500">{row.totalNoAsistieron}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`font-semibold ${row.pctAsistencia >= 75 ? 'text-green-600' : row.pctAsistencia >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>
                      {row.pctAsistencia}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
