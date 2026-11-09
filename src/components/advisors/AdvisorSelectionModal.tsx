'use client'

import { useState, Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'

interface Advisor {
  _id: string
  primerNombre: string
  primerApellido: string
  email?: string
  telefono?: string
  numeroId?: string
  zoom?: string
}

interface AdvisorSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  advisors: Advisor[]
  selectedAdvisorIds: string[]
  onSelectAdvisor: (advisor: Advisor) => void
}

export default function AdvisorSelectionModal({
  isOpen,
  onClose,
  advisors,
  selectedAdvisorIds,
  onSelectAdvisor
}: AdvisorSelectionModalProps) {
  const [searchTerm, setSearchTerm] = useState('')

  // Filtrar advisors basado en el término de búsqueda
  const filteredAdvisors = advisors.filter(advisor => {
    const searchLower = searchTerm.toLowerCase()
    const fullName = `${advisor.primerNombre || ''} ${advisor.primerApellido || ''}`.toLowerCase()
    return fullName.includes(searchLower) ||
           (advisor.email || '').toLowerCase().includes(searchLower)
  })

  const handleSelectAdvisor = (advisor: Advisor) => {
    if (!selectedAdvisorIds.includes(advisor._id)) {
      onSelectAdvisor(advisor)
    }
  }

  const handleClose = () => {
    setSearchTerm('')
    onClose()
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-gray-900"
                  >
                    Seleccionar Advisor
                  </Dialog.Title>
                  <button
                    type="button"
                    className="rounded-md text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    onClick={handleClose}
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                {/* Search */}
                <div className="mb-4">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      placeholder="Buscar guía..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-sm"
                    />
                  </div>
                </div>

                {/* Advisors List */}
                <div className="max-h-64 overflow-y-auto">
                  {filteredAdvisors.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <p>No se encontraron guías</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {filteredAdvisors.map((advisor) => {
                        const isSelected = selectedAdvisorIds.includes(advisor._id)
                        const isDisabled = isSelected

                        return (
                          <button
                            key={advisor._id}
                            onClick={() => handleSelectAdvisor(advisor)}
                            disabled={isDisabled}
                            className={`
                              w-full text-left px-3 py-2 rounded-md transition-colors
                              ${isDisabled
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : 'hover:bg-gray-50 text-gray-900'
                              }
                            `}
                          >
                            <div className="flex items-center">
                              <div className="h-8 w-8 flex-shrink-0">
                                <div className={`
                                  h-8 w-8 rounded-full flex items-center justify-center
                                  ${isDisabled ? 'bg-gray-200' : 'bg-primary-100'}
                                `}>
                                  <span className={`
                                    text-xs font-medium
                                    ${isDisabled ? 'text-gray-400' : 'text-primary-700'}
                                  `}>
                                    {(advisor.primerNombre?.[0] || '').toUpperCase()}
                                    {(advisor.primerApellido?.[0] || '').toUpperCase()}
                                  </span>
                                </div>
                              </div>
                              <div className="ml-3 flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">
                                  {advisor.primerNombre} {advisor.primerApellido}
                                </div>
                                {advisor.email && (
                                  <div className="text-xs text-gray-500 truncate">
                                    {advisor.email}
                                  </div>
                                )}
                              </div>
                              {isSelected && (
                                <div className="ml-2">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                    Seleccionado
                                  </span>
                                </div>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-transparent rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                    onClick={handleClose}
                  >
                    Cerrar
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}