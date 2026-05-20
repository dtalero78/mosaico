'use client'

import { useState } from 'react'
import { Person, FinancialData, Beneficiary } from '@/types'
import { cn } from '@/lib/utils'
import PersonGeneral from './PersonGeneral'
import PersonContact from './PersonContact'
import PersonFinancial from './PersonFinancial'
import PersonAdmin from './PersonAdmin'
import PersonComments from './PersonComments'
import PersonDocuments from './PersonDocuments'

interface PersonTabsProps {
  person: Person
  financialData?: FinancialData
  beneficiaries: Beneficiary[]
  /** Tab inicial. Acepta el id interno o un alias amigable de URL (ej. 'financiera' → 'financial'). */
  initialTab?: string
}

const tabs = [
  { id: 'general', name: 'Información General', icon: 'ℹ️' },
  { id: 'contact', name: 'Contacto y Referencias', icon: '📞' },
  { id: 'financial', name: 'Financiera', icon: '💰' },
  { id: 'admin', name: 'Administración', icon: '⚙️' },
  { id: 'comments', name: 'Comentarios', icon: '💬' },
  { id: 'docs', name: 'Documentación', icon: '📎' },
]

// Alias para deep-links desde URL (?tab=financiera, ?tab=admin, etc.)
const TAB_ALIASES: Record<string, string> = {
  financiera: 'financial',
  financial: 'financial',
  general: 'general',
  contacto: 'contact',
  contact: 'contact',
  administracion: 'admin',
  administración: 'admin',
  admin: 'admin',
  comentarios: 'comments',
  comments: 'comments',
  documentacion: 'docs',
  documentación: 'docs',
  docs: 'docs',
}

function resolveInitialTab(initial?: string): string {
  if (!initial) return 'general'
  const key = initial.toLowerCase()
  return TAB_ALIASES[key] || 'general'
}

export default function PersonTabs({ person, financialData, beneficiaries, initialTab }: PersonTabsProps) {
  const [activeTab, setActiveTab] = useState(() => resolveInitialTab(initialTab))

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return <PersonGeneral person={person} />
      case 'contact':
        return <PersonContact person={person} />
      case 'financial':
        return <PersonFinancial person={person} financialData={financialData} />
      case 'admin':
        return <PersonAdmin person={person} beneficiaries={beneficiaries} />
      case 'comments':
        return <PersonComments personId={person._id} />
      case 'docs':
        return <PersonDocuments documents={person.documentacion || []} />
      default:
        return <PersonGeneral person={person} />
    }
  }

  return (
    <div className="card">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm",
                activeTab === tab.id
                  ? "border-primary-500 text-primary-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              )}
            >
              <span>{tab.icon}</span>
              <span>{tab.name}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {renderTabContent()}
      </div>
    </div>
  )
}