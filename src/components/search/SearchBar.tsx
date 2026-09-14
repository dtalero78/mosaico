'use client'

import { useState, useRef, useEffect } from 'react'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useSearch } from '@/hooks/use-search'

export default function SearchBar() {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const { data: results, isLoading } = useSearch(submittedQuery, { debounceMs: 0 })

  const allResults = (() => {
    const fromPeople = (results?.data?.people || []).map((p: any) => ({
      ...p,
      type: p.tipoUsuario === 'TITULAR' ? 'person' : 'student',
      source: 'people'
    }))
    const fromAcademica = (results?.data?.academica || []).map((s: any) => ({
      ...s,
      tipoUsuario: 'BENEFICIARIO', // always student, regardless of what the PEOPLE JOIN returned
      type: 'student',
      source: 'academica'
    }))

    // Deduplicate fromAcademica by _id (JOIN with PEOPLE can produce duplicate rows
    // if PEOPLE has multiple records with the same numeroId)
    const seenAcademicaIds = new Set<string>()
    const dedupedAcademica = fromAcademica.filter((r: any) => {
      if (seenAcademicaIds.has(r._id)) return false
      seenAcademicaIds.add(r._id)
      return true
    })

    // From PEOPLE: only show TITULARs (BENEFICIARIOs always come from ACADEMICA)
    // La llave de dedupe es (numeroId + contrato), NO el numeroId solo: un titular
    // PUEDE tener varios contratos y cada uno es su propia fila en PEOPLE. Con la
    // llave anterior el buscador mostraba UNO ARBITRARIO de ellos (el orden es por
    // nombre, así que ni siquiera el más reciente) y escondía el resto, sin forma de
    // llegar al otro. Lo que sí sigue colapsando es la fila repetida de verdad:
    // mismo numeroId Y mismo contrato.
    const seenTitularIds = new Set<string>()
    const filteredPeople = fromPeople.filter((r: any) => {
      if (r.tipoUsuario !== 'TITULAR') return false
      const clave = String(r.numeroId) + '|' + String(r.contrato ?? '')
      if (seenTitularIds.has(clave)) return false
      seenTitularIds.add(clave)
      return true
    })

    return [...dedupedAcademica, ...filteredPeople]
  })()

  const handleSearch = () => {
    if (query.trim().length >= 2) {
      setSubmittedQuery(query.trim())
      setIsOpen(true)
      setSelectedIndex(-1)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (isOpen && selectedIndex >= 0) {
        handleResultClick(allResults[selectedIndex])
      } else {
        handleSearch()
      }
      return
    }

    if (!isOpen || allResults.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => (prev < allResults.length - 1 ? prev + 1 : prev))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1))
        break
      case 'Escape':
        setIsOpen(false)
        setSelectedIndex(-1)
        inputRef.current?.blur()
        break
    }
  }

  const handleResultClick = (result: any) => {
    if (result.type === 'person') {
      router.push(`/person/${result._id}`)
    } else {
      if (result.type === 'student' && result.hasOwnProperty('nivel')) {
        router.push(`/student/${result._id}`)
      } else {
        const academicRecord = results?.data?.academica.find(
          (academic: any) => academic.numeroId === result.numeroId
        )
        if (academicRecord) {
          router.push(`/student/${academicRecord._id}`)
        } else {
          const titularRecord = results?.data?.people.find(
            (person: any) => person.numeroId === result.numeroId && person.tipoUsuario === 'TITULAR'
          )
          if (titularRecord) {
            router.push(`/person/${titularRecord._id}`)
          } else {
            alert('Este beneficiario no tiene registro académico activo ni titular asociado.')
          }
        }
      }
    }
    setIsOpen(false)
    setQuery('')
    setSubmittedQuery('')
    setSelectedIndex(-1)
  }

  const clearSearch = () => {
    setQuery('')
    setSubmittedQuery('')
    setIsOpen(false)
    setSelectedIndex(-1)
    inputRef.current?.focus()
  }

  useEffect(() => {
    setSelectedIndex(-1)
  }, [results])

  return (
    <div className="relative flex items-center gap-2 w-full">
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="block w-full rounded-md border-0 py-2 pl-3 pr-10 text-gray-900 bg-gray-50 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-primary-600 focus:bg-white sm:text-sm sm:leading-6 transition-all duration-200"
          placeholder="Buscar por nombre, ID o número de contrato..."
        />
        {query && (
          <button
            onClick={clearSearch}
            className="absolute inset-y-0 right-0 flex items-center pr-3"
          >
            <XMarkIcon className="h-5 w-5 text-gray-400 hover:text-gray-600 transition-colors duration-150" />
          </button>
        )}
      </div>

      <button
        onClick={handleSearch}
        disabled={query.trim().length < 2}
        className="flex items-center justify-center h-9 w-9 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 flex-shrink-0"
        title="Buscar"
      >
        <MagnifyingGlassIcon className="h-5 w-5" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-10 mt-2 bg-white rounded-lg shadow-xl ring-1 ring-black ring-opacity-5 max-h-96 overflow-auto z-50">
          {isLoading ? (
            <div className="p-4 text-center">
              <div className="inline-block w-4 h-4 loading-spinner border-primary-600"></div>
              <span className="ml-2 text-sm text-gray-600">Buscando...</span>
            </div>
          ) : allResults.length > 0 ? (
            <div className="py-2">
              {allResults.map((result, index) => (
                <button
                  key={`${result.type}-${result._id}`}
                  onClick={() => handleResultClick(result)}
                  className={cn(
                    "w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors duration-150",
                    selectedIndex === index && "bg-primary-50"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-gray-900">
                          {result.primerNombre} {result.primerApellido}
                        </span>
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                          result.tipoUsuario === 'TITULAR'
                            ? "bg-primary-100 text-primary-800"
                            : (result as any).source === 'academica'
                            ? "bg-green-100 text-green-800"
                            : "bg-accent-100 text-accent-800"
                        )}>
                          {result.tipoUsuario || ((result as any).source === 'academica' ? 'Registro Académico' : 'Beneficiario')}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500">
                        ID: {result.numeroId}
                        {result.contrato && ` • Contrato: ${result.contrato}`}
                        {result.email && ` • ${result.email}`}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-gray-500">
              No se encontraron resultados para &ldquo;{submittedQuery}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  )
}
