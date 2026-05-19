'use client'

import { useState } from 'react'
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { api, handleApiError } from '@/hooks/use-api'

interface UploadDocButtonProps {
  /** PEOPLE._id where documents are stored. If null/empty, button is disabled. */
  peopleId: string | null | undefined
  /** Compact button for use inside modals; default 'md' matches the original. */
  size?: 'sm' | 'md'
  /** Custom label override (default: "Agregar Documentación"). */
  label?: string
  /** Optional callback invoked after each successful upload with the updated docs array. */
  onUploaded?: (docs: any[]) => void
}

/**
 * Reusable "Agregar Documentación" button used in three places:
 *   - Student general info (full size)
 *   - "Extender Vigencia" modal (compact)
 *   - "Activar OnHold" modal (compact)
 *
 * Wraps the same upload flow that existed inline in StudentGeneral.tsx.
 * Files are uploaded immediately on selection and attached to the student's
 * PEOPLE.documentacion list (independent from extension/onhold history).
 */
export default function UploadDocButton({
  peopleId, size = 'md', label = 'Agregar Documentación', onUploaded,
}: UploadDocButtonProps) {
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])
  const disabled = !peopleId

  const handleFileUpload = async (files: File[]) => {
    if (!files.length || !peopleId) return
    for (const file of files) {
      setUploadingFiles(prev => [...prev, file.name])
      try {
        const formData = new FormData()
        formData.append('file', file)
        const uploadRes = await fetch(`/api/contracts/${peopleId}/upload-url`, {
          method: 'POST', body: formData,
        })
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}))
          throw new Error(err.error || `Upload failed: ${uploadRes.status}`)
        }
        const { publicUrl } = await uploadRes.json()
        const saved = await api.post(`/api/contracts/${peopleId}/documents`, {
          url: publicUrl, nombre: file.name, tipo: file.type,
        })
        if (onUploaded) onUploaded(saved.documentacion || [])
        toast.success(`${file.name} subido`)
      } catch (err) {
        handleApiError(err, `Error subiendo ${file.name}`)
      } finally {
        setUploadingFiles(prev => prev.filter(n => n !== file.name))
      }
    }
  }

  const openFileChooser = () => {
    if (disabled) return
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,application/pdf'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      handleFileUpload(Array.from(input.files || []))
      document.body.removeChild(input)
    })
    input.click()
  }

  const sizeClasses =
    size === 'sm'
      ? 'px-3 py-1.5 text-xs gap-1.5'
      : 'px-4 py-2 text-sm gap-2'
  const iconClasses = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'

  return (
    <button
      type="button"
      onClick={openFileChooser}
      disabled={disabled || uploadingFiles.length > 0}
      className={`inline-flex items-center ${sizeClasses} bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium`}
    >
      <ArrowUpTrayIcon className={iconClasses} />
      <span>{uploadingFiles.length > 0 ? `Subiendo (${uploadingFiles.length})...` : label}</span>
    </button>
  )
}
