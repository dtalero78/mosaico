'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { Person, Beneficiary } from '@/types'
import { formatDate } from '@/lib/utils'
import { UserPlusIcon } from '@heroicons/react/24/outline'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { PermissionGuard } from '@/components/permissions'
import { PersonPermission } from '@/types/permissions'
import CursoCampaignFields, { type CursoRow } from '@/components/contract/CursoCampaignFields'
import { generateUserLogin } from '@/lib/user-login'

interface PersonAdminProps {
  person: Person
  beneficiaries: Beneficiary[]
}

// Plataformas activas (solo para dropdown Plataforma)
const PREFIJOS_PAISES = [
  { pais: "Chile", prefijo: "+56" },
  { pais: "Colombia", prefijo: "+57" },
  { pais: "Ecuador", prefijo: "+593" },
  { pais: "Perú", prefijo: "+51" },
]

// Indicativos telefónicos disponibles (para selector de celular)
const PREFIJOS_CELULAR = [
  { pais: "Australia", codigo: "AU", prefijo: "+61" },
  { pais: "Chile", codigo: "CL", prefijo: "+56" },
  { pais: "Colombia", codigo: "CO", prefijo: "+57" },
  { pais: "Ecuador", codigo: "EC", prefijo: "+593" },
  { pais: "Estados Unidos", codigo: "US", prefijo: "+1" },
  { pais: "Perú", codigo: "PE", prefijo: "+51" },
]

/**
 * ¿El beneficiario ya está aprobado? Se mira `aprobacion` (no el `estado` derivado,
 * que mezcla aprobación con actividad): uno recién agregado nace inactivo y sin
 * aprobar, y debe poder aprobarse. Tolera la variante legacy 'Aprobada'.
 */
function isBeneficiaryApproved(b: Beneficiary): boolean {
  const a = (b as any).aprobacion
  if (a) return a === 'Aprobado' || a === 'Aprobada'
  // Sin `aprobacion` en el payload (p.ej. estado optimista), caemos al estado.
  return b.estado === 'Aprobado'
}

export default function PersonAdmin({ person, beneficiaries }: PersonAdminProps) {
  console.log('🧪 PersonAdmin render - Props:', {
    personId: person._id,
    beneficiariesCount: beneficiaries?.length || 0,
    beneficiaries
  })
  const [selectedEstado, setSelectedEstado] = useState(person.aprobacion || 'Pendiente')
  const [newComment, setNewComment] = useState('')
  // Confirmación antes de guardar el beneficiario
  const [confirmBeneficiario, setConfirmBeneficiario] = useState(false)
  // Edición del apoderado POR beneficiario, desde su tarjeta. Va aparte del
  // formulario "Modificar Beneficiario" a propósito: el apoderado se corrige
  // solo, sin que los campos obligatorios del beneficiario lo bloqueen.
  const [editApoderadoBenId, setEditApoderadoBenId] = useState<string | null>(null)
  const [confirmApoderadoBenId, setConfirmApoderadoBenId] = useState<string | null>(null)
  const [savingApoderado, setSavingApoderado] = useState(false)
  const [apoderadoForm, setApoderadoForm] = useState({ apoderado: '', apoderadoTelefono: '', apoderadoMail: '' })
  const [showBeneficiaryForm, setShowBeneficiaryForm] = useState(false)
  const [newBeneficiaryId, setNewBeneficiaryId] = useState<string | null>(null)
  const [currentFormStep, setCurrentFormStep] = useState(1)
  const [beneficiaryData, setBeneficiaryData] = useState({
    primerNombre: '',
    segundoNombre: '',
    primerApellido: '',
    segundoApellido: '',
    numeroId: '',
    fechaNacimiento: '',
    edad: '',
    pais: 'Chile',
    domicilio: '',
    ciudad: '',
    celularPrefijo: '+56',
    celular: '',
    email: '',
    genero: '',
    // Apoderado propio del beneficiario
    apoderado: '',
    apoderadoTelefono: '',
    apoderadoMail: '',
    // Curso (cascada Campaña → Curso → Horario sobre CURSOS_CAMPAIGN)
    campaign: '',
    tipoCurso: '',
    horarioCurso: ''
  })
  const [currentBeneficiaries, setCurrentBeneficiaries] = useState<Beneficiary[]>(beneficiaries)
  const [isEditMode, setIsEditMode] = useState(false)
  const [editingBeneficiaryId, setEditingBeneficiaryId] = useState<string | null>(null)
  // Catálogo de cursos para la cascada del alta. Se cargan TODOS los activos (no se
  // aplica el filtro de matrícula de Crear Contrato): aquí se agrega a un contrato
  // que ya existe, y la campaña de los hermanos suele estar ya en curso.
  const [cursosCampaign, setCursosCampaign] = useState<CursoRow[]>([])

  useEffect(() => {
    fetch('/api/postgres/cursos-campaign')
      .then(r => r.json())
      .then(j => setCursosCampaign(j.rows || []))
      .catch(err => console.warn('No se pudo cargar el catálogo de cursos:', err))
  }, [])

  /** Campaña de los beneficiarios ya existentes → default del nuevo. */
  const campaignPorDefecto = useMemo(() => {
    const c = currentBeneficiaries.map(b => (b as any).campaign).filter(Boolean)
    return c[0] || ''
  }, [currentBeneficiaries])

  /** userLogin del nuevo beneficiario — se genera cuando hay nombre + documento. */
  const nuevoUserLogin = useMemo(() => {
    if (isEditMode) return ''
    const { primerNombre, primerApellido, numeroId } = beneficiaryData
    if (!primerNombre || !primerApellido || !numeroId) return ''
    return generateUserLogin(primerNombre, primerApellido, numeroId)
    // Estable mientras no cambien nombre/apellido/documento (generateUserLogin
    // incluye una parte aleatoria; regenerarlo en cada render lo haría saltar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beneficiaryData.primerNombre, beneficiaryData.primerApellido, beneficiaryData.numeroId, isEditMode])
  const [approvingBeneficiaries, setApprovingBeneficiaries] = useState<Set<string>>(new Set())
  const [processStatus, setProcessStatus] = useState<Record<string, string>>({})
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [beneficiaryToDelete, setBeneficiaryToDelete] = useState<Beneficiary | null>(null)
  const [isDeletingBeneficiary, setIsDeletingBeneficiary] = useState(false)
  const [showEstadoModal, setShowEstadoModal] = useState(false)
  const [pendingEstado, setPendingEstado] = useState<string | null>(null)
  const [originalEstado, setOriginalEstado] = useState<string>(person.aprobacion || 'Pendiente')
  const [isUpdatingEstado, setIsUpdatingEstado] = useState(false)
  const [isTogglingContract, setIsTogglingContract] = useState(false)

  // Modal "Motivo de suspensión administrativa" — usado por el toggle del
  // contrato y por el botón "Inactivar" individual de beneficiario.
  // Cuando target.kind = 'contract'  → afecta titular + todos los beneficiarios
  // Cuando target.kind = 'beneficiary' → afecta sólo a ese beneficiario
  type SuspendTarget =
    | { kind: 'contract'; activate: boolean }
    | { kind: 'beneficiary'; activate: boolean; beneficiary: Beneficiary }
  const [suspendTarget, setSuspendTarget] = useState<SuspendTarget | null>(null)
  const [suspendMotivo, setSuspendMotivo] = useState('')
  const [isSubmittingSuspend, setIsSubmittingSuspend] = useState(false)

  // Sincronizar las props con el estado local
  useEffect(() => {
    console.log('🔄 PersonAdmin: Beneficiaries props changed:', beneficiaries)
    setCurrentBeneficiaries(beneficiaries)
  }, [beneficiaries])

  // Mock comments
  const comments = [
    {
      _id: '1',
      tipo: 'Seguimiento',
      prioridad: 'Media',
      comentario: 'Cliente solicita información sobre horarios disponibles para beneficiario adicional.',
      autor: 'Ana García',
      fechaCreacion: '2024-08-15T10:30:00Z'
    },
    {
      _id: '2',
      tipo: 'Información',
      prioridad: 'Baja',
      comentario: 'Documentación completa recibida y verificada.',
      autor: 'Carlos López',
      fechaCreacion: '2024-08-10T14:15:00Z'
    }
  ]

  const estadoOptions = [
    'Aprobado',
    'Contrato nulo',
    'Devuelto',
    'Pendiente',
    'Rechazado',
    'Retractado',
  ]

  // Estados que SOLO aplican antes de aprobar.
  // Post-aprobación el backend rechaza estos cambios con 400 + mensaje.
  const PRE_APPROVAL_ONLY = ['Contrato nulo', 'Devuelto', 'Rechazado']
  // Estados post-aprobación que requieren confirmación simple (sin bloqueo)
  const SIMPLE_CONFIRM_POST_APPROVAL = ['Pendiente', 'Retractado']

  /** Abre la edición del apoderado de UNA tarjeta, precargada con sus datos. */
  const handleEditApoderado = (b: Beneficiary) => {
    setApoderadoForm({
      apoderado: (b as any).apoderado || '',
      apoderadoTelefono: (b as any).apoderadoTelefono || '',
      apoderadoMail: (b as any).apoderadoMail || '',
    })
    setEditApoderadoBenId(b._id)
  }

  /**
   * Guarda SOLO los 3 campos del apoderado de ese beneficiario. No envía ningún
   * otro campo, así que no lo condiciona el estado de los datos del beneficiario
   * (p.ej. registros sin domicilio o sin ciudad).
   */
  const handleSaveApoderado = async (beneficiaryId: string) => {
    setSavingApoderado(true)
    try {
      const payload = {
        apoderado: apoderadoForm.apoderado.trim() || null,
        apoderadoTelefono: apoderadoForm.apoderadoTelefono.trim() || null,
        apoderadoMail: apoderadoForm.apoderadoMail.trim() || null,
      }
      const res = await fetch(`/api/postgres/people/${beneficiaryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar el apoderado')

      setCurrentBeneficiaries(prev =>
        prev.map(ben => (ben._id === beneficiaryId ? ({ ...ben, ...payload } as Beneficiary) : ben))
      )
      setEditApoderadoBenId(null)
    } catch (e: any) {
      alert(`Error al guardar el apoderado: ${e?.message || e}`)
    } finally {
      setSavingApoderado(false)
    }
  }

  const handleApproveSpecificBeneficiary = async (beneficiaryId: string) => {
    if (!beneficiaryId) return

    setApprovingBeneficiaries(prev => new Set(prev).add(beneficiaryId))
    setProcessStatus(prev => ({ ...prev, [beneficiaryId]: 'Aprobando...' }))

    try {
      const response = await fetch(`/api/postgres/people/${beneficiaryId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setCurrentBeneficiaries(prev =>
          prev.map(ben =>
            ben._id === beneficiaryId
              ? {
                  ...ben,
                  estado: 'Aprobado',
                  aprobacion: 'Aprobado',
                  // La aprobación activa al beneficiario y le crea la ACADEMICA si faltaba.
                  estadoInactivo: false,
                  ...(data.academicId ? { academicaId: data.academicId, existeEnAcademica: true } : {}),
                }
              : ben
          )
        )

        // Build status message based on what the server did
        const parts: string[] = ['Aprobado']
        if (data.academicCreated) parts.push('+ Registro académico')
        if (data.whatsappSent) parts.push('+ WhatsApp enviado ✅')
        if (data.titularAutoApproved) parts.push('+ Titular aprobado')

        // Show WhatsApp error prominently if it failed
        if (data.whatsappError) {
          parts.push('⚠️ WhatsApp NO enviado')
          alert(`⚠️ Persona aprobada pero el WhatsApp NO se envió.\n\nError: ${data.whatsappError}\n\nDeberás enviar el mensaje manualmente.`)
        } else if (!data.whatsappSent && !data.whatsappError) {
          parts.push('(sin celular)')
        }

        setProcessStatus(prev => ({ ...prev, [beneficiaryId]: parts.join(' ') }))

        // If titular was auto-approved, update the titular estado in the UI
        if (data.titularAutoApproved) {
          setSelectedEstado('Aprobado')
          setOriginalEstado('Aprobado')
        }

        setTimeout(() => {
          setProcessStatus(prev => { const s = { ...prev }; delete s[beneficiaryId]; return s })
          setApprovingBeneficiaries(prev => { const s = new Set(prev); s.delete(beneficiaryId); return s })
        }, 5000)
      } else {
        console.error('❌ Error aprobando beneficiario:', data.error)
        setProcessStatus(prev => ({ ...prev, [beneficiaryId]: `Error: ${data.error || 'desconocido'} ❌` }))
        setTimeout(() => {
          setProcessStatus(prev => { const s = { ...prev }; delete s[beneficiaryId]; return s })
          setApprovingBeneficiaries(prev => { const s = new Set(prev); s.delete(beneficiaryId); return s })
        }, 3000)
      }
    } catch (error) {
      console.error('❌ Error aprobando beneficiario:', error)
      setProcessStatus(prev => ({ ...prev, [beneficiaryId]: 'Error ❌' }))
      setTimeout(() => {
        setProcessStatus(prev => { const s = { ...prev }; delete s[beneficiaryId]; return s })
        setApprovingBeneficiaries(prev => { const s = new Set(prev); s.delete(beneficiaryId); return s })
      }, 3000)
    }
  }

  const handleEstadoChange = (newEstado: string) => {
    console.log('=== handleEstadoChange INICIADO ===')
    console.log('Nuevo estado solicitado:', newEstado)
    console.log('Estado actual:', selectedEstado)

    // Bloqueo client-side: si el contrato ya está Aprobado, los estados
    // "pre-aprobación" no se permiten. El backend también lo rechaza.
    if (originalEstado === 'Aprobado' && PRE_APPROVAL_ONLY.includes(newEstado)) {
      alert(
        `No se puede cambiar a "${newEstado}" después de aprobar el contrato.\n\n` +
        `Estos estados (Contrato nulo, Devuelto, Rechazado) sólo aplican antes de aprobar.\n` +
        `Usa "Retractado" si necesitas anular el contrato post-aprobación.`
      )
      // Volver a sincronizar el dropdown con el estado real
      setSelectedEstado(originalEstado as any)
      return
    }

    // Guardar el estado pendiente y mostrar modal de confirmación
    setPendingEstado(newEstado)
    setShowEstadoModal(true)
  }

  const handleAddComment = () => {
    if (newComment.trim()) {
      console.log('Adding comment:', newComment)
      // API call would go here
      setNewComment('')
    }
  }

  const handleDeleteBeneficiary = (beneficiary: Beneficiary) => {
    setBeneficiaryToDelete(beneficiary)
    setShowDeleteModal(true)
  }

  const handleInactivateBeneficiary = (beneficiary: Beneficiary) => {
    // El botón "Inactivar" individual abre el mismo modal de motivo que
    // el toggle del contrato. Pasa por /toggle-status (con suspenddata
    // + suspendcount) en lugar de PATCH directo a /people/[id].
    setSuspendTarget({ kind: 'beneficiary', activate: false, beneficiary })
    setSuspendMotivo('')
  }

  const confirmDeleteBeneficiary = async () => {
    if (!beneficiaryToDelete) return

    setIsDeletingBeneficiary(true)

    try {
      const response = await fetch(`/api/postgres/people/${beneficiaryToDelete._id}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setCurrentBeneficiaries(prev =>
          prev.filter(b => b._id !== beneficiaryToDelete._id)
        )
        setShowDeleteModal(false)
        setBeneficiaryToDelete(null)
      } else {
        console.error('❌ Error al eliminar beneficiario:', data.error)
      }
    } catch (error) {
      console.error('❌ Error eliminando beneficiario:', error)
    } finally {
      setIsDeletingBeneficiary(false)
    }
  }

  const cancelDeleteBeneficiary = () => {
    setShowDeleteModal(false)
    setBeneficiaryToDelete(null)
  }

  const confirmEstadoChange = async () => {
    if (!pendingEstado) return

    console.log('=== CONFIRMACIÓN DE CAMBIO DE ESTADO INICIADA ===')
    console.log('Estado a aplicar:', pendingEstado)

    setIsUpdatingEstado(true)

    try {
      let response: Response
      let data: any

      if (pendingEstado === 'Aprobado') {
        // Use the approve endpoint for full approval flow
        // (creates ACADEMICA record + sends WhatsApp + auto-approves titular)
        response = await fetch(`/api/postgres/people/${person._id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        data = await response.json()
      } else {
        // For other states, use the regular PATCH
        response = await fetch(`/api/postgres/people/${person._id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aprobacion: pendingEstado })
        })
        data = await response.json()
      }

      if (response.ok && data.success) {
        setSelectedEstado(pendingEstado as any)
        setOriginalEstado(pendingEstado as any)
        setShowEstadoModal(false)
        setPendingEstado(null)

        // Show WhatsApp feedback for approve action
        if (pendingEstado === 'Aprobado') {
          // Build summary message
          const lines: string[] = []

          // Titular WhatsApp status
          if (data.whatsappSent) {
            lines.push('✅ Titular aprobado y WhatsApp enviado.')
          } else if (data.whatsappError) {
            lines.push(`⚠️ Titular aprobado pero WhatsApp NO enviado: ${data.whatsappError}`)
          } else {
            lines.push('✅ Titular aprobado (sin celular para WhatsApp).')
          }

          // Beneficiaries approved (when titular is approved)
          if (data.beneficiariesApproved && data.beneficiariesApproved.length > 0) {
            lines.push(`\n👥 ${data.beneficiariesApproved.length} beneficiario(s) aprobados:`)
            for (const ben of data.beneficiariesApproved) {
              if (ben.whatsappSent) {
                lines.push(`  ✅ ${ben.nombre} - WhatsApp enviado`)
              } else if (ben.whatsappError) {
                lines.push(`  ⚠️ ${ben.nombre} - WhatsApp falló: ${ben.whatsappError}`)
              } else {
                lines.push(`  ✅ ${ben.nombre} - Aprobado (sin celular)`)
              }
            }

            // Update all beneficiaries to Aprobado in the UI
            setCurrentBeneficiaries(prev =>
              prev.map(ben => {
                const approved = data.beneficiariesApproved.find((b: any) => b.personId === ben._id)
                return approved ? { ...ben, estado: 'Aprobado', aprobacion: 'Aprobado' } : ben
              })
            )
          } else if (data.beneficiariesCount === 0) {
            lines.push('\nNo hay beneficiarios pendientes por aprobar.')
          }

          alert(lines.join('\n'))
        }
      } else {
        console.error('❌ Error al actualizar estado:', data.error)
        alert(`❌ Error al actualizar estado: ${data.error || 'Error desconocido'}`)
        setSelectedEstado(originalEstado as any)
      }
    } catch (error) {
      console.error('❌ Error actualizando estado:', error)
      setSelectedEstado(originalEstado as any)
    } finally {
      setIsUpdatingEstado(false)
    }
  }

  const cancelEstadoChange = () => {
    console.log('=== CANCELANDO CAMBIO DE ESTADO ===')

    // Restaurar estado original
    setSelectedEstado(originalEstado as any)

    // Cerrar modal
    setShowEstadoModal(false)
    setPendingEstado(null)

    console.log('✓ Cambio de estado cancelado')
  }

  const handleToggleContractStatus = () => {
    // Abre el modal "Motivo" antes de ejecutar. La acción se ejecuta en
    // confirmSuspendAction cuando el usuario llena motivo y confirma.
    const activate = person.estadoInactivo === true // si está inactivo, queremos activar
    setSuspendTarget({ kind: 'contract', activate })
    setSuspendMotivo('')
  }

  /**
   * Ejecuta la suspensión/reactivación real (toggle del contrato o de un
   * beneficiario individual). Llama a /toggle-status pasando el motivo
   * obligatorio. Se invoca desde el botón "Confirmar" del modal.
   */
  const confirmSuspendAction = async () => {
    if (!suspendTarget) return
    if (!suspendMotivo.trim()) {
      alert('El motivo es obligatorio.')
      return
    }

    setIsSubmittingSuspend(true)
    if (suspendTarget.kind === 'contract') setIsTogglingContract(true)

    try {
      const motivo = suspendMotivo.trim()
      const ids = suspendTarget.kind === 'contract'
        ? [person._id, ...currentBeneficiaries.map(b => b._id)]
        : [suspendTarget.beneficiary._id]
      const activate = suspendTarget.activate

      let failures = 0
      for (const id of ids) {
        const res = await fetch(`/api/postgres/students/${id}/toggle-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: activate, motivo }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.success) failures++
      }

      if (failures === 0) {
        if (suspendTarget.kind === 'contract') {
          alert(
            `✅ Contrato ${activate ? 'activado' : 'inactivado'} exitosamente\n\n` +
            `Personas actualizadas: ${ids.length}`
          )
          window.location.href = window.location.href
        } else {
          // Beneficiario individual: actualizar lista local sin recargar
          const ben = suspendTarget.beneficiary
          setCurrentBeneficiaries(prev =>
            prev.map(b =>
              b._id === ben._id
                ? { ...b, estado: activate ? 'Aprobado' : ('Inactivo' as any), estadoInactivo: !activate }
                : b
            )
          )
          setSuspendTarget(null)
          setSuspendMotivo('')
        }
      } else {
        alert(`❌ Error al cambiar estado: ${failures} de ${ids.length} fallaron`)
      }
    } catch (error) {
      console.error('Error al cambiar estado:', error)
      alert('❌ Error al comunicarse con el servidor')
    } finally {
      setIsSubmittingSuspend(false)
      setIsTogglingContract(false)
    }
  }

  const cancelSuspendAction = () => {
    if (isSubmittingSuspend) return
    setSuspendTarget(null)
    setSuspendMotivo('')
  }

  const handleEditBeneficiary = async (beneficiaryId: string) => {
    setIsEditMode(true)
    setEditingBeneficiaryId(beneficiaryId)

    try {
      const response = await fetch(`/api/postgres/people/${beneficiaryId}`)
      if (response.ok) {
        const result = await response.json()
        if (result.success && result.person) {
          const ben = result.person

          setBeneficiaryData({
            primerNombre: ben.primerNombre || '',
            segundoNombre: ben.segundoNombre || '',
            primerApellido: ben.primerApellido || '',
            segundoApellido: ben.segundoApellido || '',
            numeroId: ben.numeroId || '',
            fechaNacimiento: ben.fechaNacimiento || '',
            edad: ben.edad || '',
            pais: ben.pais || ben.plataforma || 'Chile',
            domicilio: ben.domicilio || '',
            ciudad: ben.ciudad || '',
            celularPrefijo: ben.celularPrefijo || '+56',
            celular: ben.celular || '',
            email: ben.email || '',
            genero: ben.genero || '',
            apoderado: ben.apoderado || '',
            apoderadoTelefono: ben.apoderadoTelefono || '',
            apoderadoMail: ben.apoderadoMail || '',
            // Solo informativo al editar: el curso se cambia con "Cambio Académico".
            campaign: ben.campaign || '',
            tipoCurso: ben.tipoCurso || '',
            horarioCurso: ben.horarioCurso || ''
          })

          setNewBeneficiaryId(beneficiaryId)
          setShowBeneficiaryForm(true)
          setCurrentFormStep(1)
        }
      }
    } catch (error) {
      console.error('Error loading beneficiary:', error)
    }
  }

  const handleAddBeneficiary = () => {
    setIsEditMode(false)
    setEditingBeneficiaryId(null)
    setBeneficiaryData({
      primerNombre: '',
      segundoNombre: '',
      primerApellido: '',
      segundoApellido: '',
      numeroId: '',
      fechaNacimiento: '',
      edad: '',
      pais: 'Chile',
      domicilio: '',
      ciudad: '',
      celularPrefijo: '+56',
      celular: '',
      email: '',
      genero: '',
      apoderado: '',
      apoderadoTelefono: '',
      apoderadoMail: '',
      // Default: la campaña en la que están los otros beneficiarios del contrato.
      campaign: campaignPorDefecto,
      tipoCurso: '',
      horarioCurso: ''
    })
    setNewBeneficiaryId('__new__')
    setShowBeneficiaryForm(true)
    setCurrentFormStep(1)
  }

  const handleBeneficiaryDataChange = (field: string, value: string) => {
    setBeneficiaryData(prev => ({ ...prev, [field]: value }))
  }

  const validateRequiredFields = (step: number): boolean => {
    if (step === 1) {
      return (
        beneficiaryData.primerNombre.trim() !== '' &&
        beneficiaryData.primerApellido.trim() !== '' &&
        beneficiaryData.numeroId.trim() !== '' &&
        beneficiaryData.pais !== ''
      )
    } else if (step === 2) {
      return (
        beneficiaryData.fechaNacimiento !== '' &&
        beneficiaryData.genero !== '' &&
        beneficiaryData.ciudad !== '' &&
        beneficiaryData.domicilio.trim() !== '' &&
        beneficiaryData.celular.trim() !== '' &&
        beneficiaryData.email.trim() !== ''
      )
    } else if (step === 3) {
      // Sin curso no hay salón ni bookings al aprobar → obligatorio.
      return (
        beneficiaryData.campaign !== '' &&
        beneficiaryData.tipoCurso !== '' &&
        beneficiaryData.horarioCurso !== ''
      )
    }
    return true
  }

  const handleFormNext = () => {
    // Validar campos obligatorios antes de avanzar
    if (validateRequiredFields(currentFormStep)) {
      if (currentFormStep < 3) {
        setCurrentFormStep(currentFormStep + 1)
      }
    } else {
      alert('Por favor complete todos los campos obligatorios marcados con *')
    }
  }

  const handleFormPrev = () => {
    if (currentFormStep > 1) {
      setCurrentFormStep(currentFormStep - 1)
    }
  }

  const handleSaveBeneficiary = async () => {
    const isEdit = isEditMode && !!editingBeneficiaryId
    // En CREAR: el celular es solo el número local, hay que concatenar el prefijo.
    //   "+57" + "3008021701" → "573008021701"
    // En EDITAR: el celular en BD ya incluye el prefijo (ej: "573008021701").
    //   El form lo carga completo en el input y el usuario lo edita tal cual.
    //   Si concatenáramos prefijo otra vez, se generaría un doble prefijo
    //   (bug que impedía cambiar el celular de beneficiarios existentes).
    const normalizedCelular = isEdit
      ? (beneficiaryData.celular || '').replace(/\D/g, '')
      : ((beneficiaryData.celularPrefijo || '') + (beneficiaryData.celular || '')).replace(/\D/g, '')

    try {
      let response: Response

      if (isEditMode && editingBeneficiaryId) {
        // PATCH — datos del beneficiario. El apoderado NO viaja aquí: tiene su
        // propio guardado en la tarjeta, independiente de estos campos.
        // numeroId NO se edita (llave de identidad: enlaza PEOPLE/ACADEMICA/bookings).
        // Campaña/curso/salón/horario se cambian con "Cambio Académico" (ajusta cupos y bookings).
        response = await fetch(`/api/postgres/people/${editingBeneficiaryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primerNombre: beneficiaryData.primerNombre,
            segundoNombre: beneficiaryData.segundoNombre || null,
            primerApellido: beneficiaryData.primerApellido,
            segundoApellido: beneficiaryData.segundoApellido || null,
            fechaNacimiento: beneficiaryData.fechaNacimiento || null,
            celular: normalizedCelular || undefined,
            email: beneficiaryData.email,
            domicilio: beneficiaryData.domicilio || null,
            ciudad: beneficiaryData.ciudad || null,
          })
        })
      } else {
        // POST — alta en el contrato del titular. El endpoint reusa la misma lógica
        // de Crear Contrato: PEOPLE con su curso real + ACADEMICA (puente WELCOME)
        // + USUARIOS_ROLES con su userLogin, y descuenta el cupo del curso.
        // El contrato, la plataforma y la vigencia se toman del titular server-side.
        response = await fetch(`/api/postgres/people/${person._id}/beneficiario`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primerNombre: beneficiaryData.primerNombre,
            segundoNombre: beneficiaryData.segundoNombre || null,
            primerApellido: beneficiaryData.primerApellido,
            segundoApellido: beneficiaryData.segundoApellido || null,
            numeroId: beneficiaryData.numeroId,
            email: beneficiaryData.email,
            celular: normalizedCelular || null,
            fechaNacimiento: beneficiaryData.fechaNacimiento || null,
            ciudad: beneficiaryData.ciudad || null,
            domicilio: beneficiaryData.domicilio || null,
            // Curso del beneficiario
            campaign: beneficiaryData.campaign,
            tipoCurso: beneficiaryData.tipoCurso,
            horarioCurso: beneficiaryData.horarioCurso,
            userLogin: nuevoUserLogin || null,
            // Apoderado propio del beneficiario
            apoderado: beneficiaryData.apoderado?.trim() || null,
            apoderadoTelefono: beneficiaryData.apoderadoTelefono?.trim() || null,
            apoderadoMail: beneficiaryData.apoderadoMail?.trim() || null,
          })
        })
      }

      const result = await response.json()

      if (response.ok && result.success) {
        if (isEditMode && editingBeneficiaryId) {
          setCurrentBeneficiaries(prev =>
            prev.map(ben =>
              ben._id === editingBeneficiaryId
                ? {
                    ...ben,
                    nombre: beneficiaryData.primerNombre,
                    apellido: [beneficiaryData.primerApellido, beneficiaryData.segundoApellido].filter(Boolean).join(' '),
                    celular: normalizedCelular || beneficiaryData.celular,
                    email: beneficiaryData.email,
                  } as Beneficiary
                : ben
            )
          )
        } else {
          // Add newly created beneficiary to the list
          const created = result.person
          const newBen: Beneficiary = {
            _id: created._id,
            numeroId: created.numeroId,
            nombre: created.primerNombre,
            apellido: [created.primerApellido, created.segundoApellido].filter(Boolean).join(' '),
            celular: (created.celular || '').replace(/\D/g, '') || created.celular || '',
            // Nace inactivo/sin aprobar, igual que en Crear Contrato: es la
            // aprobación la que genera los bookings y lo activa. `aprobacion: null`
            // deja visible el botón Aprobar de su tarjeta.
            estado: 'Inactivo',
            aprobacion: null,
            fechaCreacion: created._createdDate || new Date().toISOString(),
            apoderado: beneficiaryData.apoderado,
            apoderadoTelefono: beneficiaryData.apoderadoTelefono,
            apoderadoMail: beneficiaryData.apoderadoMail,
            campaign: created.campaign,
            curso: created.tipoCurso,
            salon: created.salon,
            horarioCurso: created.horarioCurso,
            // El alta ya crea la ACADEMICA (puente WELCOME); sin esto la tarjeta
            // mostraría "SIN REGISTRO ACADÉMICO" hasta recargar.
            academicaId: result.academicaId || null,
            existeEnAcademica: !!result.academicaId,
          } as Beneficiary
          setCurrentBeneficiaries(prev => [...prev, newBen])
          if (result.userLogin) {
            alert(`Beneficiario creado.\n\nUsuario de login: ${result.userLogin}\n\nQueda pendiente de aprobación — usa el botón "Aprobar" de su tarjeta para generar sus agendamientos y habilitar el acceso.`)
          }
        }

        setShowBeneficiaryForm(false)
        setNewBeneficiaryId(null)
        setIsEditMode(false)
        setEditingBeneficiaryId(null)
        setBeneficiaryData({
          primerNombre: '', segundoNombre: '', primerApellido: '', segundoApellido: '',
          numeroId: '', fechaNacimiento: '', edad: '', pais: 'Chile', domicilio: '',
          ciudad: '', celularPrefijo: '+56', celular: '', email: '', genero: '',
          apoderado: '', apoderadoTelefono: '', apoderadoMail: '',
          campaign: '', tipoCurso: '', horarioCurso: ''
        })
        setCurrentFormStep(1)
      } else {
        console.error('❌ Error guardando beneficiario:', result.error, result.details)
        alert(`Error: ${result.error || 'No se pudo guardar el beneficiario'}\n${result.details || ''}`)
      }
    } catch (error) {
      console.error('❌ Error guardando beneficiario:', error)
    }
  }

  const getEstadoBadgeClass = (estado: string): string => {
    switch (estado) {
      case 'Aprobado':
        return 'badge-success'
      case 'Pendiente':
        return 'badge-warning'
      case 'Rechazado':
        return 'badge-danger'
      case 'ON HOLD':
        return 'badge-warning'
      case 'Eliminado':
        return 'badge-danger'
      case 'Inactivo':
        return 'badge-secondary'
      default:
        return 'badge-info'
    }
  }

  const getPrioridadBadgeClass = (prioridad: string): string => {
    switch (prioridad) {
      case 'Crítica':
        return 'badge-danger'
      case 'Alta':
        return 'badge-warning'
      case 'Media':
        return 'badge-info'
      case 'Baja':
        return 'badge-success'
      default:
        return 'badge-info'
    }
  }

  console.log('🔍 currentBeneficiaries antes del render:', currentBeneficiaries)

  return (
    <div className="space-y-8">
      {/* Acciones (Contract-wide Actions) */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">⚙️ Acciones</h3>
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h4 className="text-base font-semibold text-gray-900">Estado del Contrato</h4>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
                  !person.estadoInactivo
                    ? 'bg-green-100 text-green-800 border border-green-300'
                    : 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                }`}>
                  {!person.estadoInactivo ? '✅ ACTIVO' : '⚠️ INACTIVO'}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-1">
                Inactivar el contrato {person.contrato} afectará:
              </p>
              <ul className="text-xs text-gray-500 space-y-1 ml-4">
                <li>• Titular: {person.primerNombre} {person.primerApellido}</li>
                <li>• {currentBeneficiaries.length} beneficiario(s) asociado(s)</li>
                <li>• Actualización en bases de datos PEOPLE y ACADEMICA</li>
              </ul>
            </div>
            <PermissionGuard permission={PersonPermission.ACTIVAR_DESACTIVAR}>
              <div className="flex items-center gap-4 ml-6">
                <span className={`text-sm font-semibold ${!person.estadoInactivo ? 'text-green-600' : 'text-gray-400'}`}>
                  Activo
                </span>
                <button
                  onClick={handleToggleContractStatus}
                  disabled={isTogglingContract}
                  className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                    isTogglingContract
                      ? 'bg-gray-300 cursor-not-allowed'
                      : !person.estadoInactivo
                        ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
                        : 'bg-gray-300 hover:bg-gray-400 focus:ring-gray-400'
                  }`}
                  title={!person.estadoInactivo ? 'Inactivar contrato completo' : 'Activar contrato completo'}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform duration-200 shadow-md ${
                      !person.estadoInactivo ? 'translate-x-9' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className={`text-sm font-semibold ${person.estadoInactivo ? 'text-yellow-600' : 'text-gray-400'}`}>
                  Inactivo
                </span>
              </div>
            </PermissionGuard>
          </div>
        </div>

      </div>

      {/* Titular Status */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Estado del Titular</h3>
        <PermissionGuard permission={PersonPermission.CAMBIAR_ESTADO}>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Estado Actual
                </label>
                <select
                  value={selectedEstado}
                  onChange={(e) => handleEstadoChange(e.target.value)}
                  className="input-field"
                >
                  {estadoOptions
                    // Si ya está Aprobado, ocultar opciones pre-aprobación
                    // ('Contrato nulo', 'Devuelto', 'Rechazado').
                    .filter(estado =>
                      originalEstado !== 'Aprobado' || !PRE_APPROVAL_ONLY.includes(estado)
                    )
                    .map((estado) => (
                      <option key={estado} value={estado}>
                        {estado === 'Aprobado' && '✅ '}
                        {estado === 'Contrato nulo' && '⚪ '}
                        {estado === 'Devuelto' && '🔄 '}
                        {estado === 'Pendiente' && '⏳ '}
                        {estado === 'Rechazado' && '❌ '}
                        {estado === 'Retractado' && '↩️ '}
                        {estado}
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex items-center">
                <div>
                  <span className="text-sm font-medium text-gray-700">Estado Visible:</span>
                  <div className="mt-1">
                    <span className={`badge ${getEstadoBadgeClass(selectedEstado)}`}>
                      {selectedEstado}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </PermissionGuard>
      </div>

      {/* Beneficiaries Management */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Gestión de Beneficiarios</h3>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <div className="space-y-4">
          {currentBeneficiaries.map((beneficiary) => {
            const whatsappSent = (beneficiary as any).whatsappSent
            console.log(`🔄 Renderizando ${beneficiary.nombre}: estado=${beneficiary.estado}, whatsappSent=${whatsappSent}, celular=${beneficiary.celular}`)
            return (
            <div key={beneficiary._id} className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3">
                    <h4 className="font-medium text-gray-900">
                      {beneficiary.nombre} {beneficiary.apellido}
                    </h4>
                    {/* Un beneficiario sin aprobar nace inactivo — mostrarlo como
                        "Inactivo" a secas confundía (parecía dado de baja). */}
                    {isBeneficiaryApproved(beneficiary) ? (
                      <span className={`badge ${getEstadoBadgeClass(beneficiary.estado)}`}>
                        {beneficiary.estado}
                      </span>
                    ) : (
                      <span className="badge badge-warning">Pendiente de aprobación</span>
                    )}
                    {!(beneficiary as any).existeEnAcademica && (
                      <span className="badge bg-red-100 text-red-700">
                        SIN REGISTRO ACADÉMICO
                      </span>
                    )}
                    {beneficiary.estado === 'Aprobado' && whatsappSent && (
                      <div className="flex items-center space-x-1 text-green-600 bg-green-100 px-2 py-1 rounded" title="WhatsApp enviado">
                        <span className="text-sm">📱✅ WhatsApp Enviado</span>
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    ID: {beneficiary.numeroId} • Creado: {formatDate(beneficiary.fechaCreacion)}
                    {beneficiary.celular && ` • Tel: ${beneficiary.celular}`}
                    {beneficiary.curso && ` • Curso: ${beneficiary.curso}`}
                    {beneficiary.salon && ` • Salón: ${beneficiary.salon}`}
                    {(beneficiary as any).horarioCurso && ` • Horario: ${(beneficiary as any).horarioCurso}`}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <PermissionGuard permission={PersonPermission.MODIFICAR}>
                    <button
                      onClick={() => handleEditBeneficiary(beneficiary._id)}
                      className="inline-flex items-center px-4 py-1.5 border border-blue-600 text-sm font-medium rounded text-blue-600 bg-white hover:bg-blue-600 hover:text-white transition-colors"
                      title="Modificar beneficiario"
                    >
                      Modificar
                    </button>
                  </PermissionGuard>
                  {/* Aprobar — visible mientras el beneficiario NO esté aprobado, y
                      desaparece al aprobarlo. Se decide por `aprobacion` (no por
                      `estado`): un beneficiario recién agregado nace inactivo y
                      antes quedaba como "Inactivo" sin forma de aprobarlo. Aprueba
                      SOLO a este beneficiario (crea su ACADEMICA si falta, genera
                      sus agendamientos y le envía el WhatsApp de bienvenida). */}
                  {(!isBeneficiaryApproved(beneficiary) || approvingBeneficiaries.has(beneficiary._id)) && (
                    <PermissionGuard permission={PersonPermission.APROBAR}>
                      <button
                        onClick={() => handleApproveSpecificBeneficiary(beneficiary._id)}
                        disabled={approvingBeneficiaries.has(beneficiary._id)}
                        className="inline-flex items-center px-4 py-1.5 border border-black text-sm font-medium rounded text-black bg-white hover:bg-black hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Aprobar solo a este beneficiario"
                      >
                        {approvingBeneficiaries.has(beneficiary._id) ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-black mr-1.5"></div>
                            {processStatus[beneficiary._id] || 'Procesando...'}
                          </>
                        ) : (
                          'Aprobar'
                        )}
                      </button>
                    </PermissionGuard>
                  )}
                  {isBeneficiaryApproved(beneficiary) ? (
                    // Aprobado y activo → se puede inactivar. Aprobado pero inactivo
                    // (OnHold / inactivación admin) → solo se informa el estado.
                    beneficiary.estado === 'Inactivo' ? (
                      <div className="inline-flex items-center px-4 py-1.5 border border-gray-400 text-sm font-medium rounded text-gray-500 bg-gray-50 cursor-not-allowed">
                        Inactivo
                      </div>
                    ) : (
                      <PermissionGuard permission={PersonPermission.ACTIVAR_DESACTIVAR}>
                        <button
                          onClick={() => handleInactivateBeneficiary(beneficiary)}
                          className="inline-flex items-center px-4 py-1.5 border border-orange-600 text-sm font-medium rounded text-orange-600 bg-white hover:bg-orange-600 hover:text-white transition-colors"
                          title="Inactivar beneficiario"
                        >
                          Inactivar
                        </button>
                      </PermissionGuard>
                    )
                  ) : (
                    <PermissionGuard permission={PersonPermission.ELIMINAR}>
                      <button
                        onClick={() => handleDeleteBeneficiary(beneficiary)}
                        className="inline-flex items-center px-4 py-1.5 border border-red-600 text-sm font-medium rounded text-red-600 bg-white hover:bg-red-600 hover:text-white transition-colors"
                        title="Eliminar beneficiario"
                      >
                        Eliminar
                      </button>
                    </PermissionGuard>
                  )}
                </div>
              </div>

              {/* Apoderado propio de este beneficiario — se edita y guarda aparte
                  de los datos del beneficiario (su propio botón y su propio PATCH). */}
              <div className="mt-3 pt-3 border-t border-blue-200">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-blue-500 font-semibold">Apoderado</p>
                  {editApoderadoBenId === beneficiary._id ? (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setEditApoderadoBenId(null)} disabled={savingApoderado}
                        className="text-xs px-3 py-1 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                        Cancelar
                      </button>
                      <button type="button" onClick={() => setConfirmApoderadoBenId(beneficiary._id)} disabled={savingApoderado}
                        className="text-xs px-3 py-1 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">
                        {savingApoderado ? 'Guardando…' : 'Guardar'}
                      </button>
                    </div>
                  ) : (
                    <PermissionGuard permission={PersonPermission.MODIFICAR}>
                      <button type="button" onClick={() => handleEditApoderado(beneficiary)}
                        className="text-xs px-3 py-1 bg-primary-100 text-primary-700 rounded-lg hover:bg-primary-200 font-medium"
                        title="Editar solo el apoderado de este beneficiario">
                        Editar apoderado
                      </button>
                    </PermissionGuard>
                  )}
                </div>
                {editApoderadoBenId === beneficiary._id ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Nombre</label>
                      <input type="text" value={apoderadoForm.apoderado}
                        onChange={e => setApoderadoForm(f => ({ ...f, apoderado: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Nombre completo" />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Teléfono</label>
                      <input type="tel" value={apoderadoForm.apoderadoTelefono}
                        onChange={e => setApoderadoForm(f => ({ ...f, apoderadoTelefono: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Correo</label>
                      <input type="email" value={apoderadoForm.apoderadoMail}
                        onChange={e => setApoderadoForm(f => ({ ...f, apoderadoMail: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    <div>
                      <span className="block text-[11px] uppercase tracking-wide text-gray-400">Nombre</span>
                      <span className="text-gray-900">{(beneficiary as any).apoderado || '—'}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] uppercase tracking-wide text-gray-400">Teléfono</span>
                      <span className="text-gray-900">{(beneficiary as any).apoderadoTelefono || '—'}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] uppercase tracking-wide text-gray-400">Correo</span>
                      <span className="text-gray-900 break-all">{(beneficiary as any).apoderadoMail || '—'}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            )
          })}

          {/* Add Beneficiary Button - Now at the bottom */}
          <PermissionGuard permission={PersonPermission.AGREGAR_BENEFICIARIO}>
            <div className="pt-4 flex justify-end">
              <button
                onClick={handleAddBeneficiary}
                className="btn-primary flex items-center space-x-2"
              >
                <UserPlusIcon className="h-4 w-4" />
                <span>Agregar Beneficiario</span>
              </button>
            </div>
          </PermissionGuard>
          </div>
        </div>
      </div>

      {/* WhatsApp Administrative */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">📱 WhatsApp Administrativo</h3>
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-green-800 mb-3">Mensajería Masiva</h4>
              <div className="space-y-2">
                <button className="w-full text-left p-3 bg-white border border-green-200 rounded hover:bg-green-50">
                  <div className="font-medium text-green-900">Recordatorio de Pago</div>
                  <div className="text-sm text-green-700">Enviar recordatorio de cuota mensual</div>
                </button>
                <button className="w-full text-left p-3 bg-white border border-green-200 rounded hover:bg-green-50">
                  <div className="font-medium text-green-900">Actualización de Contrato</div>
                  <div className="text-sm text-green-700">Notificar cambios en el contrato</div>
                </button>
              </div>
            </div>
            <div>
              <h4 className="font-medium text-green-800 mb-3">Automatizaciones</h4>
              <div className="space-y-2">
                <button className="w-full text-left p-3 bg-white border border-green-200 rounded hover:bg-green-50">
                  <div className="font-medium text-green-900">Bienvenida Nuevo Beneficiario</div>
                  <div className="text-sm text-green-700">Mensaje automático para nuevos estudiantes</div>
                </button>
                <button className="w-full text-left p-3 bg-white border border-green-200 rounded hover:bg-green-50">
                  <div className="font-medium text-green-900">Seguimiento Progreso</div>
                  <div className="text-sm text-green-700">Actualizaciones de progreso académico</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Beneficiary Form Modal */}
      {showBeneficiaryForm && newBeneficiaryId && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {isEditMode
                  ? `Modificar Beneficiario`
                  : `Crear Nuevo Beneficiario para ${person.primerNombre} ${person.primerApellido}`
                }
              </h3>
              <button
                onClick={() => {
                  setShowBeneficiaryForm(false)
                  setNewBeneficiaryId(null)
                  setCurrentFormStep(1)
                  setIsEditMode(false)
                  setEditingBeneficiaryId(null)
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {/* Edit Mode: Only 3 fields */}
            {isEditMode ? (
              <div className="space-y-5">
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">Datos del Beneficiario</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Primer Nombre *</label>
                      <input type="text" value={beneficiaryData.primerNombre}
                        onChange={(e) => handleBeneficiaryDataChange('primerNombre', e.target.value)}
                        className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Segundo Nombre</label>
                      <input type="text" value={beneficiaryData.segundoNombre}
                        onChange={(e) => handleBeneficiaryDataChange('segundoNombre', e.target.value)}
                        className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Primer Apellido *</label>
                      <input type="text" value={beneficiaryData.primerApellido}
                        onChange={(e) => handleBeneficiaryDataChange('primerApellido', e.target.value)}
                        className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Segundo Apellido</label>
                      <input type="text" value={beneficiaryData.segundoApellido}
                        onChange={(e) => handleBeneficiaryDataChange('segundoApellido', e.target.value)}
                        className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Número de ID</label>
                      <input type="text" value={beneficiaryData.numeroId} disabled
                        className="input-field bg-gray-100 cursor-not-allowed" />
                      <p className="text-[11px] text-gray-400 mt-1">No editable (enlaza con académica y agendamientos)</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Nacimiento</label>
                      <input type="date" value={(beneficiaryData.fechaNacimiento || '').slice(0, 10)}
                        onChange={(e) => handleBeneficiaryDataChange('fechaNacimiento', e.target.value)}
                        className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Celular *</label>
                      <input type="tel" value={beneficiaryData.celular}
                        onChange={(e) => handleBeneficiaryDataChange('celular', e.target.value)}
                        className="input-field" placeholder="Número de celular" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                      <input type="email" value={beneficiaryData.email}
                        onChange={(e) => handleBeneficiaryDataChange('email', e.target.value)}
                        className="input-field" placeholder="Correo electrónico" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Domicilio</label>
                      <input type="text" value={beneficiaryData.domicilio}
                        onChange={(e) => handleBeneficiaryDataChange('domicilio', e.target.value)}
                        className="input-field" placeholder="Dirección de domicilio" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ciudad</label>
                      <input type="text" value={beneficiaryData.ciudad}
                        onChange={(e) => handleBeneficiaryDataChange('ciudad', e.target.value)}
                        className="input-field" placeholder="Ciudad" />
                    </div>
                  </div>
                </div>

                <p className="text-xs text-gray-500 pt-2 border-t border-gray-200">
                  El <strong>apoderado</strong> se edita aparte, con el botón “Editar apoderado”
                  de la tarjeta del beneficiario.
                </p>
              </div>
            ) : (
              <>
                {/* Step 1: Basic Information */}
                {currentFormStep === 1 && (
                  <div className="space-y-4">
                    <h4 className="font-medium text-gray-900 mb-4">Información Básica</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Primer Nombre *
                        </label>
                        <input
                          type="text"
                          value={beneficiaryData.primerNombre}
                          onChange={(e) => handleBeneficiaryDataChange('primerNombre', e.target.value)}
                          className="input-field"
                          placeholder="Primer nombre"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Segundo Nombre
                        </label>
                        <input
                          type="text"
                          value={beneficiaryData.segundoNombre}
                          onChange={(e) => handleBeneficiaryDataChange('segundoNombre', e.target.value)}
                          className="input-field"
                          placeholder="Segundo nombre"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Primer Apellido *
                        </label>
                        <input
                          type="text"
                          value={beneficiaryData.primerApellido}
                          onChange={(e) => handleBeneficiaryDataChange('primerApellido', e.target.value)}
                          className="input-field"
                          placeholder="Primer apellido"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Segundo Apellido
                        </label>
                        <input
                          type="text"
                          value={beneficiaryData.segundoApellido}
                          onChange={(e) => handleBeneficiaryDataChange('segundoApellido', e.target.value)}
                          className="input-field"
                          placeholder="Segundo apellido"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Número de Identificación *
                        </label>
                        <input
                          type="text"
                          value={beneficiaryData.numeroId}
                          onChange={(e) => handleBeneficiaryDataChange('numeroId', e.target.value)}
                          className="input-field"
                          placeholder="Número de ID"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Plataforma *
                        </label>
                        <select
                          value={beneficiaryData.pais}
                          onChange={(e) => handleBeneficiaryDataChange('pais', e.target.value)}
                          className="input-field"
                        >
                          <option value="">Seleccionar</option>
                          {PREFIJOS_PAISES.map(item => (
                            <option key={item.pais} value={item.pais}>
                              {item.pais}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 2: Contact and Personal Information */}
                {currentFormStep === 2 && (
                  <div className="space-y-4">
                    <h4 className="font-medium text-gray-900 mb-4">Información Personal y Contacto</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Fecha de Nacimiento *
                        </label>
                        <input
                          type="date"
                          value={beneficiaryData.fechaNacimiento}
                          onChange={(e) => handleBeneficiaryDataChange('fechaNacimiento', e.target.value)}
                          className="input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Género *
                        </label>
                        <select
                          value={beneficiaryData.genero}
                          onChange={(e) => handleBeneficiaryDataChange('genero', e.target.value)}
                          className="input-field"
                        >
                          <option value="">Seleccionar</option>
                          <option value="Masculino">Masculino</option>
                          <option value="Femenino">Femenino</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Ciudad *
                        </label>
                        <input
                          type="text"
                          value={beneficiaryData.ciudad}
                          onChange={(e) => handleBeneficiaryDataChange('ciudad', e.target.value)}
                          className="input-field"
                          placeholder="Ciudad"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Domicilio *
                        </label>
                        <input
                          type="text"
                          value={beneficiaryData.domicilio}
                          onChange={(e) => handleBeneficiaryDataChange('domicilio', e.target.value)}
                          className="input-field"
                          placeholder="Dirección de domicilio"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Celular *
                        </label>
                        <div className="flex gap-2">
                          <select
                            value={beneficiaryData.celularPrefijo}
                            onChange={(e) => handleBeneficiaryDataChange('celularPrefijo', e.target.value)}
                            className="input-field w-28 flex-shrink-0"
                          >
                            {PREFIJOS_CELULAR.map(item => (
                              <option key={item.codigo} value={item.prefijo}>
                                {item.prefijo} ({item.codigo})
                              </option>
                            ))}
                          </select>
                          <input
                            type="tel"
                            value={beneficiaryData.celular}
                            onChange={(e) => handleBeneficiaryDataChange('celular', e.target.value)}
                            className="input-field flex-1"
                            placeholder="Número de celular"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Email *
                        </label>
                        <input
                          type="email"
                          value={beneficiaryData.email}
                          onChange={(e) => handleBeneficiaryDataChange('email', e.target.value)}
                          className="input-field"
                          placeholder="Correo electrónico"
                        />
                      </div>
                    </div>

                    {/* Apoderado propio del beneficiario */}
                    <div className="pt-4 mt-4 border-t border-gray-200">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-gray-900">Apoderado de este beneficiario</h4>
                        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={
                              !!beneficiaryData.apoderado &&
                              beneficiaryData.apoderado === `${person.primerNombre || ''} ${person.primerApellido || ''}`.trim()
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setBeneficiaryData(prev => ({
                                  ...prev,
                                  apoderado: `${person.primerNombre || ''} ${person.primerApellido || ''}`.trim(),
                                  apoderadoTelefono: person.celular || '',
                                  apoderadoMail: person.email || '',
                                }))
                              } else {
                                setBeneficiaryData(prev => ({
                                  ...prev, apoderado: '', apoderadoTelefono: '', apoderadoMail: '',
                                }))
                              }
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          ¿El titular será el apoderado?
                        </label>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del apoderado</label>
                          <input type="text" value={beneficiaryData.apoderado}
                            onChange={(e) => handleBeneficiaryDataChange('apoderado', e.target.value)}
                            className="input-field" placeholder="Nombre completo" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono del apoderado</label>
                          <input type="tel" value={beneficiaryData.apoderadoTelefono}
                            onChange={(e) => handleBeneficiaryDataChange('apoderadoTelefono', e.target.value)}
                            className="input-field" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Correo del apoderado</label>
                          <input type="email" value={beneficiaryData.apoderadoMail}
                            onChange={(e) => handleBeneficiaryDataChange('apoderadoMail', e.target.value)}
                            className="input-field" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 3: Curso (campaña → curso → horario) */}
                {currentFormStep === 3 && (
                  <div className="space-y-4">
                    <h4 className="font-medium text-gray-900">Curso del beneficiario</h4>
                    <p className="text-sm text-gray-500 -mt-2">
                      La campaña viene precargada con la de los demás beneficiarios del contrato.
                      Al aprobar el beneficiario se generan sus agendamientos en este curso.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <CursoCampaignFields
                        rows={cursosCampaign}
                        values={{
                          campaign: beneficiaryData.campaign,
                          tipoCurso: beneficiaryData.tipoCurso,
                          horarioCurso: beneficiaryData.horarioCurso,
                        }}
                        onPatch={(patch) => setBeneficiaryData(prev => ({ ...prev, ...patch }))}
                        esImpulsa={(person as any).esCursoImpulsa === true}
                        userLogin={nuevoUserLogin}
                      />
                    </div>
                    <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                      Se creará su <strong>usuario de login</strong> ({nuevoUserLogin || '—'}), bloqueado hasta
                      una semana antes del inicio del curso. El beneficiario queda <strong>pendiente de aprobación</strong>.
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Form Navigation */}
            {isEditMode ? (
              <div className="flex justify-end mt-6 pt-4 border-t border-gray-200">
                {/* Sólo se exige lo que identifica a la persona y su login (nombre,
                    celular y email). Domicilio y ciudad NO bloquean: muchos
                    beneficiarios nunca los capturaron y exigirlos impedía editar
                    cualquier otro dato (p.ej. el apoderado) en esos registros. */}
                <button
                  onClick={() => setConfirmBeneficiario(true)}
                  disabled={
                    !beneficiaryData.primerNombre.trim() || !beneficiaryData.primerApellido.trim() ||
                    !beneficiaryData.celular.trim() || !beneficiaryData.email.trim()
                  }
                  title={
                    !beneficiaryData.primerNombre.trim() || !beneficiaryData.primerApellido.trim() ||
                    !beneficiaryData.celular.trim() || !beneficiaryData.email.trim()
                      ? 'Complete nombre, apellido, celular y email'
                      : 'Guardar cambios del beneficiario'
                  }
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Guardar Cambios
                </button>
              </div>
            ) : (
              <>
                <div className="flex justify-between mt-6 pt-4 border-t border-gray-200">
                  <div className="flex space-x-2">
                    {currentFormStep > 1 && (
                      <button
                        onClick={handleFormPrev}
                        className="btn-secondary"
                      >
                        Anterior
                      </button>
                    )}
                  </div>

                  <div className="flex space-x-2">
                    {currentFormStep < 3 ? (
                      <button
                        onClick={handleFormNext}
                        className="btn-primary"
                      >
                        Siguiente
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (validateRequiredFields(3)) setConfirmBeneficiario(true)
                          else alert('Seleccione la campaña, el curso y el horario del beneficiario')
                        }}
                        className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Crear Beneficiario
                      </button>
                    )}
                  </div>
                </div>

                {/* Step indicator */}
                <div className="mt-4 flex justify-center">
                  <div className="flex space-x-2">
                    {[1, 2, 3].map((step) => (
                      <div
                        key={step}
                        className={`w-3 h-3 rounded-full ${
                          step === currentFormStep ? 'bg-primary-600' :
                          step < currentFormStep ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && beneficiaryToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                Eliminar Beneficiario
              </h3>
            </div>

            <div className="mb-4">
              <p className="text-sm text-gray-500">
                ¿Estás seguro de que quieres eliminar a{' '}
                <span className="font-medium text-gray-900">
                  {beneficiaryToDelete.nombre} {beneficiaryToDelete.apellido}
                </span>
                ?
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Esta acción eliminará el beneficiario tanto de la plataforma como de Académica y no se puede deshacer.
              </p>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={cancelDeleteBeneficiary}
                disabled={isDeletingBeneficiary}
                className="flex-1 bg-white border border-gray-300 rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteBeneficiary}
                disabled={isDeletingBeneficiary}
                className="flex-1 bg-red-600 border border-transparent rounded-md px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isDeletingBeneficiary ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Eliminando...
                  </>
                ) : (
                  'Eliminar'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Estado Change Confirmation Modal */}
      {showEstadoModal && pendingEstado && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center mb-4">
              <div className="flex-shrink-0">
                <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center">
                  <span className="text-blue-600 text-sm font-medium">!</span>
                </div>
              </div>
              <div className="ml-3">
                <h3 className="text-lg font-medium text-gray-900">
                  Confirmar Cambio de Estado
                </h3>
              </div>
            </div>

            <div className="mb-4">
              <p className="text-sm text-gray-500">
                ¿Estás seguro de que quieres cambiar el estado de{' '}
                <span className="font-medium text-gray-900">
                  {person.primerNombre} {person.primerApellido}
                </span>{' '}
                a{' '}
                <span className="font-medium text-gray-900">
                  {pendingEstado}
                </span>
                ?
              </p>
              {originalEstado === 'Aprobado' && SIMPLE_CONFIRM_POST_APPROVAL.includes(pendingEstado) && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                  <strong>⚠ Atención:</strong> el contrato ya está <strong>Aprobado</strong>.
                  Verifica que ningún beneficiario esté actualmente en clase activa y
                  que el contrato no tenga OnHold o extensión en curso antes de confirmar.
                </div>
              )}
              <p className="text-sm text-gray-500 mt-2">
                Este cambio se aplicará en la base de datos y será visible inmediatamente.
              </p>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={cancelEstadoChange}
                disabled={isUpdatingEstado}
                className="flex-1 bg-white border border-gray-300 rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                onClick={confirmEstadoChange}
                disabled={isUpdatingEstado}
                className="flex-1 bg-blue-600 border border-transparent rounded-md px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isUpdatingEstado ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Actualizando...
                  </>
                ) : (
                  'Confirmar'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Suspensión Administrativa — Modal de Motivo */}
      {suspendTarget && (() => {
        const isContract = suspendTarget.kind === 'contract'
        const activate = suspendTarget.activate
        const verbo = activate ? 'Reactivar' : 'Inactivar'
        const verboPasado = activate ? 'reactivado' : 'inactivado'
        const targetLabel = isContract
          ? `el contrato ${person.contrato || ''} (titular + ${currentBeneficiaries.length} beneficiario(s))`
          : `al beneficiario ${suspendTarget.beneficiary.nombre} ${suspendTarget.beneficiary.apellido}`
        const headerColor = activate ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
        const btnColor = activate ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700'
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-center mb-4">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center ${headerColor}`}>
                  <span className="text-base">{activate ? '✓' : '⚠️'}</span>
                </div>
                <h3 className="ml-3 text-lg font-medium text-gray-900">
                  {verbo} {isContract ? 'Contrato' : 'Beneficiario'}
                </h3>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-3">
                  Vas a <strong>{verbo.toLowerCase()}</strong> {targetLabel}. Esta acción queda
                  registrada con tu usuario, fecha y motivo en el historial de la persona.
                </p>
                <label htmlFor="suspend-motivo" className="block text-sm font-medium text-gray-700 mb-1">
                  Motivo <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="suspend-motivo"
                  value={suspendMotivo}
                  onChange={(e) => setSuspendMotivo(e.target.value)}
                  rows={3}
                  className="input-field"
                  placeholder={activate
                    ? 'Ej: Cliente regularizó pago / Cliente solicita reactivación'
                    : 'Ej: Cliente solicitó suspensión / Mora en pagos / Solicitud del titular'}
                  disabled={isSubmittingSuspend}
                />
                <p className="text-xs text-gray-500 mt-1">
                  El motivo será visible al hacer clic en el badge amarillo &quot;SUSPENDIDA&quot;.
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={cancelSuspendAction}
                  disabled={isSubmittingSuspend}
                  className="flex-1 bg-white border border-gray-300 rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmSuspendAction}
                  disabled={isSubmittingSuspend || !suspendMotivo.trim()}
                  className={`flex-1 ${btnColor} border border-transparent rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center`}
                >
                  {isSubmittingSuspend ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Aplicando...
                    </>
                  ) : (
                    `Confirmar ${verbo}`
                  )}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Confirmación: guardar el apoderado de un beneficiario (flujo aparte) */}
      {confirmApoderadoBenId && (() => {
        const ben = currentBeneficiaries.find(b => b._id === confirmApoderadoBenId)
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/50" onClick={() => setConfirmApoderadoBenId(null)} />
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirmar apoderado</h3>
              <p className="text-sm text-gray-600 mb-4">
                Se actualizará el apoderado de <strong>{ben ? `${ben.nombre} ${ben.apellido}` : 'este beneficiario'}</strong>:
              </p>
              <dl className="text-sm bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1 mb-5">
                <div className="flex gap-2"><dt className="text-gray-500 w-20 flex-shrink-0">Nombre:</dt><dd className="text-gray-900">{apoderadoForm.apoderado || '—'}</dd></div>
                <div className="flex gap-2"><dt className="text-gray-500 w-20 flex-shrink-0">Teléfono:</dt><dd className="text-gray-900">{apoderadoForm.apoderadoTelefono || '—'}</dd></div>
                <div className="flex gap-2"><dt className="text-gray-500 w-20 flex-shrink-0">Correo:</dt><dd className="text-gray-900 break-all">{apoderadoForm.apoderadoMail || '—'}</dd></div>
              </dl>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setConfirmApoderadoBenId(null)} disabled={savingApoderado}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50">Cancelar</button>
                <button type="button" disabled={savingApoderado}
                  onClick={() => { const id = confirmApoderadoBenId; setConfirmApoderadoBenId(null); if (id) handleSaveApoderado(id) }}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50">
                  {savingApoderado ? 'Guardando…' : 'Confirmar'}</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Confirmación: guardar beneficiario (datos + apoderado) */}
      {confirmBeneficiario && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setConfirmBeneficiario(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {isEditMode ? 'Confirmar cambios del beneficiario' : 'Confirmar nuevo beneficiario'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {isEditMode ? 'Se actualizarán los datos de' : 'Se creará el beneficiario'}{' '}
              <strong>{[beneficiaryData.primerNombre, beneficiaryData.primerApellido].filter(Boolean).join(' ') || 'el beneficiario'}</strong>:
            </p>
            <dl className="text-sm bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1 mb-4">
              <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Nombre:</dt><dd className="text-gray-900">{[beneficiaryData.primerNombre, beneficiaryData.segundoNombre, beneficiaryData.primerApellido, beneficiaryData.segundoApellido].filter(Boolean).join(' ') || '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Número de ID:</dt><dd className="text-gray-900">{beneficiaryData.numeroId || '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Nacimiento:</dt><dd className="text-gray-900">{(beneficiaryData.fechaNacimiento || '').slice(0, 10) || '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Celular:</dt><dd className="text-gray-900">{beneficiaryData.celular || '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Email:</dt><dd className="text-gray-900 break-all">{beneficiaryData.email || '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Domicilio:</dt><dd className="text-gray-900">{beneficiaryData.domicilio || '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Ciudad:</dt><dd className="text-gray-900">{beneficiaryData.ciudad || '—'}</dd></div>
            </dl>
            {!isEditMode && (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Apoderado</p>
                <dl className="text-sm bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1 mb-4">
                  <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Nombre:</dt><dd className="text-gray-900">{beneficiaryData.apoderado || '—'}</dd></div>
                  <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Teléfono:</dt><dd className="text-gray-900">{beneficiaryData.apoderadoTelefono || '—'}</dd></div>
                  <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Correo:</dt><dd className="text-gray-900 break-all">{beneficiaryData.apoderadoMail || '—'}</dd></div>
                </dl>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Curso</p>
                <dl className="text-sm bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1 mb-5">
                  <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Campaña:</dt><dd className="text-gray-900">{beneficiaryData.campaign || '—'}</dd></div>
                  <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Curso:</dt><dd className="text-gray-900">{beneficiaryData.tipoCurso || '—'}</dd></div>
                  <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Horario:</dt><dd className="text-gray-900">{beneficiaryData.horarioCurso || '—'}</dd></div>
                  <div className="flex gap-2"><dt className="text-gray-500 w-28 flex-shrink-0">Usuario:</dt><dd className="text-gray-900 font-mono">{nuevoUserLogin || '—'}</dd></div>
                </dl>
              </>
            )}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmBeneficiario(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancelar</button>
              <button type="button" onClick={() => { setConfirmBeneficiario(false); handleSaveBeneficiary() }}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700">Confirmar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}