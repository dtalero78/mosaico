'use client'

const CONTACTS = [
  {
    label: 'Soporte Usuario',
    phone: '56957208697',
    message: 'Hola, soy estudiante de MOSAICO y necesito ayuda.',
    color: 'bg-blue-100 text-blue-600',
  },
  {
    label: 'Soporte Academico',
    phone: '56932631038',
    message: 'Hola, tengo una consulta academica.',
    color: 'bg-green-100 text-green-600',
  },
  {
    label: 'Chile Recaudos',
    phone: '56964077877',
    message: 'Hola, tengo una consulta sobre recaudos Chile.',
    color: 'bg-red-100 text-red-600',
  },
  {
    label: 'Col/Peru/Ec Recaudos',
    phone: '573013894444',
    message: 'Hola, tengo una consulta sobre recaudos.',
    color: 'bg-amber-100 text-amber-600',
  },
]

export default function WhatsAppContacts() {
  return (
    <div className="border-t border-gray-200 pt-6">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Let&apos;s Go assistance:
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {CONTACTS.map((contact) => {
          const url = `https://wa.me/${contact.phone}?text=${encodeURIComponent(contact.message)}`
          return (
            <a
              key={contact.label}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-gray-50 transition-colors group text-center"
            >
              <div className={`w-14 h-14 rounded-full ${contact.color} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.613.613l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.316 0-4.468-.763-6.199-2.053l-.432-.328-2.633.883.883-2.633-.328-.432A9.955 9.955 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                </svg>
              </div>
              <span className="text-xs font-medium text-gray-700 leading-tight">
                {contact.label}
              </span>
            </a>
          )
        })}
      </div>
    </div>
  )
}
