'use client'

import { useState } from 'react'
import { ChatBubbleLeftEllipsisIcon, UserIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

const PAGE_SIZE = 5

interface AdvisorCommentsProps {
  data: any
  isLoading: boolean
}

export default function AdvisorComments({ data, isLoading }: AdvisorCommentsProps) {
  const [page, setPage] = useState(0)

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-40 mb-4" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-lg mb-2" />
        ))}
      </div>
    )
  }

  const comments = data?.comments || []
  const totalPages = Math.ceil(comments.length / PAGE_SIZE)
  const paged = comments.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 min-h-[280px]">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Comentarios Guía:
      </h3>
      {comments.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <ChatBubbleLeftEllipsisIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="text-sm">No hay comentarios aun</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {paged.map((c: any) => {
              const date = c.fechaEvento ? new Date(c.fechaEvento) : null
              const comment = c.comentarios || ''

              return (
                <div key={c._id} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <UserIcon className="h-4 w-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-900">
                      {c.advisorNombre || c.advisor || 'Advisor'}
                    </span>
                    <span className="text-xs text-gray-400">
                      {date ? format(date, 'd MMM yyyy', { locale: es }) : ''}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 ml-6">{comment}</p>
                  {c.calificacion && (
                    <div className="ml-6 mt-1">
                      <span className="text-xs font-medium text-primary-600 bg-primary-50 px-2 py-0.5 rounded">
                        Nota: {c.calificacion}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
              <span className="text-xs text-gray-500">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRightIcon className="h-5 w-5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
