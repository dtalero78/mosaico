'use client'

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { ComercialPermission } from '@/types/permissions'
import { cursosVisiblesContrato, esMenores } from '@/lib/cursos-campaign'
import { generateUserLogin } from '@/lib/user-login'
import CursoCampaignFields, { type CursoRow } from '@/components/contract/CursoCampaignFields'
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'

// Country prefixes
const COUNTRY_PREFIXES = [
  { country: "Argentina", prefix: "+54" },
  { country: "Australia", prefix: "+61" },
  { country: "Bolivia", prefix: "+591" },
  { country: "Chile", prefix: "+56" },
  { country: "Colombia", prefix: "+57" },
  { country: "Costa Rica", prefix: "+506" },
  { country: "Cuba", prefix: "+53" },
  { country: "Ecuador", prefix: "+593" },
  { country: "El Salvador", prefix: "+503" },
  { country: "España", prefix: "+34" },
  { country: "Estados Unidos", prefix: "+1" },
  { country: "Guatemala", prefix: "+502" },
  { country: "Honduras", prefix: "+504" },
  { country: "México", prefix: "+52" },
  { country: "Nicaragua", prefix: "+505" },
  { country: "Panamá", prefix: "+507" },
  { country: "Paraguay", prefix: "+595" },
  { country: "Perú", prefix: "+51" },
  { country: "Puerto Rico", prefix: "+1 787" },
  { country: "República Dominicana", prefix: "+1 809" },
  { country: "Uruguay", prefix: "+598" },
  { country: "Venezuela", prefix: "+58" },
  { country: "Otro", prefix: "" }
];

// Payment method options by country
const PAYMENT_OPTIONS: Record<string, { label: string; value: string }[]> = {
  "Colombia": [
    { label: "Transferencia", value: "Transferencia" },
    { label: "Epayco", value: "Epayco" },
    { label: "Paypal", value: "Paypal" }
  ],
  "Ecuador": [
    { label: "Transferencia", value: "Transferencia" },
    { label: "Datafast", value: "Datafast" },
    { label: "Paypal", value: "Paypal" }
  ],
  "Chile": [
    { label: "Transferencia", value: "Transferencia" },
    { label: "Webpay", value: "Webpay" },
    { label: "Paypal", value: "Paypal" }
  ],
  "Perú": [
    { label: "Transferencia", value: "Transferencia" },
    { label: "Niubiz", value: "Niubiz" }
  ]
};

const DRAFT_KEY = 'crear-contrato-draft'
const DRAFT_TTL_MS = 72 * 60 * 60 * 1000 // 72 horas

interface Beneficiario {
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  numeroId: string;
  fechaNacimiento: string;
  email?: string;
  celular?: string;
  campaign?: string;
  tipoCurso?: string;
  horarioCurso?: string;
  userLogin?: string;
}

// CursoCampaignFields + CursoRow ahora viven en @/components/contract/CursoCampaignFields
// (compartidos con Migrar Contrato).

export default function CrearContratoPage() {
  return (
    <Suspense fallback={null}>
      <CrearContratoContent />
    </Suspense>
  );
}

function CrearContratoContent() {
  const searchParams = useSearchParams();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [contractNumber, setContractNumber] = useState('');

  // Form data
  const [titular, setTitular] = useState({
    asesor: searchParams.get('email') || '',
    primerNombre: '',
    segundoNombre: '',
    primerApellido: '',
    segundoApellido: '',
    numeroId: '',
    plataforma: '',
    fechaNacimiento: '',
    pais: 'Chile',
    domicilio: '',
    ciudad: '',
    celular: '',
    telefono: '',
    ingresos: '',
    email: '',
    empresa: '',
    cargo: '',
    genero: '',
    referenciaUno: '',
    parentezcoRefUno: '',
    telRefUno: '',
    referenciaDos: '',
    parentezcoRefDos: '',
    telRefDos: '',
    // MOSAICO — curso (cuando el titular es beneficiario) + apoderado + flag Impulsa
    esCursoImpulsa: false,
    campaign: '',
    tipoCurso: '',
    horarioCurso: '',
    userLogin: '',
    apoderado: '',
    apoderadoTelefono: '',
    apoderadoMail: ''
  });

  const [financial, setFinancial] = useState({
    totalPlan: 0,
    pagoInscripcion: 0,
    saldo: 0,
    numeroCuotas: 0,
    tipoPlan: '' as '' | 'Contado' | 'Credito' | 'Colaborador',
    valorCuota: 0,
    fechaPago: '',
    vigencia: '',
    medioPago: ''
  });

  const [beneficiarios, setBeneficiarios] = useState<Beneficiario[]>([]);
  const [titularEsBeneficiario, setTitularEsBeneficiario] = useState(false);
  const [titularEsApoderado, setTitularEsApoderado] = useState(false);
  const [cursosCampaign, setCursosCampaign] = useState<CursoRow[]>([]);
  // Modal de confirmación paso 2: ni Impulsa ni titular-beneficiario marcados
  const [showSinCursoModal, setShowSinCursoModal] = useState(false);
  // Modal resumen antes de crear el contrato (paso 7)
  const [showResumenModal, setShowResumenModal] = useState(false);
  const [contrato, setContrato] = useState('');
  const [loadingContrato, setLoadingContrato] = useState(false);
  const [showDraftBanner, setShowDraftBanner] = useState(false);
  // Contrato de prueba: prefijo PRB- en el número, no afecta el consecutivo
  // real, queda visible con badge naranja y se descarta de informes.
  const [esContratoPrueba, setEsContratoPrueba] = useState(false);
  // Extemporánea: marca el contrato como matrícula fuera de plazo (PEOPLE.extemporanea)
  const [esExtemporanea, setEsExtemporanea] = useState(false);
  // Cursos visibles según EXTEMPORÁNEA: NO → solo "En matrícula"; SÍ → "Activo" de la campaña
  // inmediatamente anterior, cursos iniciados hace ≤ 2 semanas. Luego CursoCampaignFields filtra por Impulsa.
  const cursosVisibles = useMemo(() => cursosVisiblesContrato(cursosCampaign, esExtemporanea), [cursosCampaign, esExtemporanea]);
  const draftRestored = useRef(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  // Auto-save draft to localStorage (debounced 500ms)
  useEffect(() => {
    if (!draftRestored.current) return // Don't save until initial load is done
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          titular, financial, beneficiarios, titularEsBeneficiario, titularEsApoderado, currentStep, contrato, esContratoPrueba, esExtemporanea,
          savedAt: Date.now()
        }))
      } catch {}
    }, 500)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [titular, financial, beneficiarios, titularEsBeneficiario, titularEsApoderado, currentStep, contrato, esContratoPrueba, esExtemporanea])

  // Generar userLogin (10 chars, auto+aleatorio) cuando se define el curso.
  // Titular-beneficiario: usa los datos del titular.
  useEffect(() => {
    if (!titularEsBeneficiario) return
    if (!(titular.campaign && titular.tipoCurso && titular.horarioCurso)) return
    if (!titular.primerNombre || !titular.numeroId || titular.userLogin) return
    setTitular(prev => prev.userLogin
      ? prev
      : { ...prev, userLogin: generateUserLogin(prev.primerNombre, prev.primerApellido, prev.numeroId) })
  }, [titularEsBeneficiario, titular.campaign, titular.tipoCurso, titular.horarioCurso, titular.primerNombre, titular.primerApellido, titular.numeroId, titular.userLogin])

  // Beneficiarios: un userLogin por beneficiario cuando su curso queda definido.
  useEffect(() => {
    setBeneficiarios(prev => {
      let changed = false
      const next = prev.map(b => {
        const cursoDef = b.campaign && b.tipoCurso && b.horarioCurso
        if (cursoDef && b.primerNombre && b.numeroId && !b.userLogin) {
          changed = true
          return { ...b, userLogin: generateUserLogin(b.primerNombre, b.primerApellido, b.numeroId) }
        }
        return b
      })
      return changed ? next : prev
    })
  }, [beneficiarios])

  // Cargar catálogo de cursos/horarios por campaña (CURSOS_CAMPAIGN)
  useEffect(() => {
    fetch('/api/postgres/cursos-campaign')
      .then(r => r.ok ? r.json() : { rows: [] })
      .then(d => setCursosCampaign(Array.isArray(d.rows) ? d.rows : []))
      .catch(() => setCursosCampaign([]))
  }, [])

  // Restore draft on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const draft = JSON.parse(raw)
        if (draft.savedAt && Date.now() - draft.savedAt < DRAFT_TTL_MS) {
          setShowDraftBanner(true)
          // Store draft temporarily so we can restore on accept
          draftRestored.current = false
          ;(window as any).__contractDraft = draft
        } else {
          localStorage.removeItem(DRAFT_KEY)
          draftRestored.current = true
        }
      } else {
        draftRestored.current = true
      }
    } catch {
      draftRestored.current = true
    }
  }, [])

  const restoreDraft = () => {
    const draft = (window as any).__contractDraft
    if (draft) {
      if (draft.titular) setTitular(draft.titular)
      if (draft.financial) setFinancial(draft.financial)
      if (draft.beneficiarios) setBeneficiarios(draft.beneficiarios)
      if (draft.titularEsBeneficiario !== undefined) setTitularEsBeneficiario(draft.titularEsBeneficiario)
      if (draft.titularEsApoderado !== undefined) setTitularEsApoderado(draft.titularEsApoderado)
      if (draft.currentStep) setCurrentStep(draft.currentStep)
      if (draft.contrato) setContrato(draft.contrato)
      if (draft.esContratoPrueba !== undefined) setEsContratoPrueba(draft.esContratoPrueba)
      if (draft.esExtemporanea !== undefined) setEsExtemporanea(draft.esExtemporanea)
      delete (window as any).__contractDraft
    }
    setShowDraftBanner(false)
    draftRestored.current = true
  }

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY)
    delete (window as any).__contractDraft
    setShowDraftBanner(false)
    draftRestored.current = true
  }

  // Auto-generate contract number when plataforma or "es prueba" change.
  // Si es prueba → genera PRB-NNNNN-YY (consecutivo independiente).
  // Si no → consecutivo normal del país (sin contaminarse por los PRB-).
  const fetchNextContractNumber = useCallback(async (plataforma: string, prueba: boolean, impulsa: boolean) => {
    if (!prueba && !plataforma) { setContrato(''); return; }
    setLoadingContrato(true);
    try {
      const qs = new URLSearchParams({ impulsa: impulsa ? 'true' : 'false' });
      if (prueba) qs.set('prueba', 'true');
      else qs.set('plataforma', plataforma);
      const res = await fetch(`/api/postgres/contracts/next-number?${qs.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setContrato(data.contrato);
      }
    } catch (err) {
      console.error('Error fetching contract number:', err);
    } finally {
      setLoadingContrato(false);
    }
  }, []);

  useEffect(() => {
    fetchNextContractNumber(titular.plataforma, esContratoPrueba, titular.esCursoImpulsa);
  }, [titular.plataforma, esContratoPrueba, titular.esCursoImpulsa, fetchNextContractNumber]);

  // Get phone prefix based on selected country (without '+')
  const getPhonePrefix = () => {
    const countryData = COUNTRY_PREFIXES.find(c => c.country === titular.pais);
    return (countryData?.prefix || '').replace(/\+/g, '').replace(/\s/g, '');
  };

  // Get payment options based on selected country
  const getPaymentOptions = () => {
    return PAYMENT_OPTIONS[titular.pais] || PAYMENT_OPTIONS['Colombia'];
  };

  // Calculate balance when total or down payment changes
  const calculateBalance = (totalPlan?: number, pagoInscripcion?: number) => {
    const total = totalPlan !== undefined ? totalPlan : (Number(financial.totalPlan) || 0);
    const downPayment = pagoInscripcion !== undefined ? pagoInscripcion : (Number(financial.pagoInscripcion) || 0);
    const balance = total - downPayment;

    setFinancial(prev => ({
      ...prev,
      saldo: balance
    }));

    // Recalcular valor de cuota con el nuevo saldo
    calculateInstallmentValue(balance, financial.numeroCuotas);
  };

  // Calculate installment value
  const calculateInstallmentValue = (saldo?: number, numeroCuotas?: number) => {
    const balance = saldo !== undefined ? saldo : (Number(financial.saldo) || 0);
    const numInstallments = numeroCuotas !== undefined ? numeroCuotas : (Number(financial.numeroCuotas) || 0);

    if (numInstallments > 0) {
      const installmentValue = balance / numInstallments;
      setFinancial(prev => ({
        ...prev,
        valorCuota: Math.round(installmentValue)
      }));
    } else {
      setFinancial(prev => ({
        ...prev,
        valorCuota: 0
      }));
    }
  };

  // Format number with thousand separators
  const formatNumber = (value: string | number): string => {
    const num = typeof value === 'string' ? value.replace(/\D/g, '') : value.toString();
    return Number(num).toLocaleString('es-CO');
  };

  // Handle numeric field change
  const handleNumericChange = (field: string, value: string, setter: any) => {
    const numericValue = value.replace(/\D/g, '');
    setter((prev: any) => ({
      ...prev,
      [field]: Number(numericValue)
    }));
  };

  // Add beneficiario
  const addBeneficiario = () => {
    setBeneficiarios([...beneficiarios, {
      primerNombre: '',
      segundoNombre: '',
      primerApellido: '',
      segundoApellido: '',
      numeroId: '',
      fechaNacimiento: '',
      email: '',
      celular: '',
      campaign: '',
      tipoCurso: '',
      horarioCurso: ''
    }]);
  };

  // Remove beneficiario
  const removeBeneficiario = (index: number) => {
    setBeneficiarios(beneficiarios.filter((_, i) => i !== index));
  };

  // Update beneficiario
  const updateBeneficiario = (index: number, field: string, value: string) => {
    const updatedBeneficiarios = [...beneficiarios];
    updatedBeneficiarios[index] = {
      ...updatedBeneficiarios[index],
      [field]: value
    };
    setBeneficiarios(updatedBeneficiarios);
  };

  // Email válido: requiere @ y un dominio con punto (algo@dominio.tld)
  const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim());

  const normStr = (s?: string) => (s || '').trim().toLowerCase();

  // Error de email de un beneficiario: no puede ser el del titular (salvo que el
  // titular sea beneficiario) ni el de otro beneficiario. Devuelve '' si OK.
  // EXCEPCIÓN MOSAICO: en cursos de menores (YOJI/OKINA/KODOMO) el contacto es el
  // del apoderado/titular, así que el email SÍ puede coincidir con el del titular.
  const benefEmailError = (index: number): string => {
    const email = normStr(beneficiarios[index]?.email);
    if (!email) return '';
    const cursoMenores = esMenores(beneficiarios[index]?.tipoCurso || '');
    if (!titularEsBeneficiario && !cursoMenores && email === normStr(titular.email)) return 'El correo no puede ser el mismo del titular.';
    if (beneficiarios.some((b, j) => j !== index && normStr(b.email) && normStr(b.email) === email)) {
      return 'Este correo ya lo tiene otro beneficiario.';
    }
    return '';
  };

  // Salón del curso seleccionado (desde el catálogo CURSOS_CAMPAIGN).
  const salonFor = (campaign?: string, tipoCurso?: string, horarioCurso?: string): string => {
    const r = cursosCampaign.find(x => x.campaign === campaign && x.tipoCurso === tipoCurso && x.horarioCurso === horarioCurso);
    return r?.salon || '';
  };

  // Advertencia (no bloquea): el celular del beneficiario es igual al del titular.
  // EXCEPCIÓN MOSAICO: en cursos de menores (YOJI/OKINA/KODOMO) el celular es el del
  // apoderado/titular, así que no se advierte.
  const benefCelularWarn = (index: number): boolean => {
    const cel = (beneficiarios[index]?.celular || '').trim();
    if (!cel || titularEsBeneficiario) return false;
    if (esMenores(beneficiarios[index]?.tipoCurso || '')) return false;
    return cel === (titular.celular || '').trim();
  };

  // Validate current step
  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        return titular.asesor !== '';
      case 2:
        return titular.primerNombre !== '' &&
               titular.primerApellido !== '' &&
               titular.numeroId !== '' &&
               titular.plataforma !== '' &&
               contrato !== '' &&
               // Si el titular es beneficiario, debe elegir campaña/curso/horario
               (!titularEsBeneficiario ||
                 (titular.campaign !== '' && titular.tipoCurso !== '' && titular.horarioCurso !== ''));
      case 3:
        return titular.fechaNacimiento !== '' &&
               titular.pais !== '' &&
               titular.domicilio !== '' &&
               titular.ciudad !== '' &&
               titular.celular !== '';
      case 4:
        return Number(titular.ingresos) > 0 &&
               isValidEmail(titular.email) &&
               titular.genero !== '';
      case 5:
        return titular.referenciaUno !== '' &&
               titular.parentezcoRefUno !== '' &&
               titular.telRefUno !== '';
      case 6:
        return financial.totalPlan > 0 &&
               financial.pagoInscripcion >= 0 &&
               financial.fechaPago !== '' &&
               financial.vigencia !== '' &&
               financial.medioPago !== '';
      default:
        return true;
    }
  };

  // Handle next button
  const handleNext = () => {
    if (!validateStep(currentStep)) {
      setError('Por favor complete todos los campos requeridos');
      return;
    }

    setError('');

    // Paso 2: si alguna de las casillas (Impulsa / titular-beneficiario) NO está
    // marcada, confirmar. El modal advierte específicamente de la(s) no marcada(s).
    // Solo avanza directo cuando AMBAS están marcadas.
    if (currentStep === 2 && !(titular.esCursoImpulsa && titularEsBeneficiario)) {
      setShowSinCursoModal(true);
      return;
    }

    if (currentStep === 3) {
      calculateBalance();
    }

    if (currentStep < 7) {
      setCurrentStep(currentStep + 1);
    }
  };

  // Handle previous button
  const handlePrevious = () => {
    setError('');
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Submit contract
  // Valida el paso final y abre el modal resumen (en vez de crear directo).
  const requestSubmit = () => {
    if (!titular.apoderado?.trim()) {
      setError('El nombre del apoderado es obligatorio.');
      return;
    }
    if (beneficiarios.some(b => !b.campaign || !b.tipoCurso || !b.horarioCurso)) {
      setError('Cada beneficiario debe tener campaña, tipo de curso y horario.');
      return;
    }
    // Email de beneficiarios: no puede repetir el del titular ni el de otro beneficiario.
    const idxEmail = beneficiarios.findIndex((_, i) => benefEmailError(i) !== '');
    if (idxEmail >= 0) {
      setError(`Beneficiario ${idxEmail + 1}: ${benefEmailError(idxEmail)}`);
      return;
    }
    setError('');
    setShowResumenModal(true);
  };

  const handleSubmit = async () => {
    setShowResumenModal(false);
    // Validación final (paso 7): apoderado obligatorio + cursos de beneficiarios
    if (!titular.apoderado?.trim()) {
      setError('El nombre del apoderado es obligatorio.');
      return;
    }
    const benefSinCurso = beneficiarios.some(
      b => !b.campaign || !b.tipoCurso || !b.horarioCurso
    );
    if (benefSinCurso) {
      setError('Cada beneficiario debe tener campaña, tipo de curso y horario.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // YYYY-MM-DD en TZ local del navegador (evita corrimiento UTC al guardar fechaPago)
      const _now = new Date();
      const clientToday = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;

      const response = await fetch('/api/postgres/contracts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contrato,
          titular: {
            ...titular,
            celular: getPhonePrefix() + titular.celular,
            // asesor es el email del comercial → también lo guardamos como asesorMail
            asesorMail: titular.asesorMail || titular.asesor,
            extemporanea: esExtemporanea,
          },
          financial,
          beneficiarios: beneficiarios.map(b => ({
            ...b,
            celular: b.celular ? getPhonePrefix() + b.celular : null
          })),
          titularEsBeneficiario,
          clientToday,
          esContratoPrueba,
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al crear el contrato');
      }

      const data = await response.json();
      setContractNumber(data.contractNumber);
      setSuccess(`Contrato creado exitosamente. Número de contrato: ${data.contractNumber}`);
      localStorage.removeItem(DRAFT_KEY);

      // Redirect to contract detail page
      if (data._id) {
        setTimeout(() => {
          window.location.href = `/dashboard/comercial/contrato/${data._id}`;
        }, 2000);
      }

    } catch (error) {
      console.error('Error:', error);
      setError(error instanceof Error ? error.message : 'Error al crear el contrato');
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <PermissionGuard permission={ComercialPermission.MODIFICAR_CONTRATO}>
        <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Crear Contrato</h1>
            <p className="mt-2 text-gray-600">Complete el formulario para crear un nuevo contrato</p>
          </div>
          {/* Checkboxes: Contrato de prueba (naranja) + Extemporánea (rojo) */}
          <div className="flex items-center gap-2 flex-wrap">
            <label
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-colors select-none ${
                esContratoPrueba
                  ? 'bg-orange-100 border-orange-500 text-orange-800 shadow-sm'
                  : 'bg-white border-orange-300 text-orange-700 hover:bg-orange-50'
              }`}
              title="Los contratos de prueba reciben prefijo PRB- y se descartan automáticamente de los informes. Pueden borrarse en Mantenimiento > Usuarios > Contratos Prueba."
            >
              <input
                type="checkbox"
                checked={esContratoPrueba}
                onChange={e => setEsContratoPrueba(e.target.checked)}
                className="h-4 w-4 rounded border-orange-400 text-orange-600 focus:ring-orange-500"
              />
              <span className="text-sm font-semibold">🧪 Contrato de prueba</span>
            </label>
            <label
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-colors select-none ${
                esExtemporanea
                  ? 'bg-red-100 border-red-500 text-red-800 shadow-sm'
                  : 'bg-white border-red-300 text-red-700 hover:bg-red-50'
              }`}
              title="Marca la matrícula como extemporánea (fuera de plazo). Se guarda en PEOPLE.extemporanea."
            >
              <input
                type="checkbox"
                checked={esExtemporanea}
                onChange={e => {
                  setEsExtemporanea(e.target.checked)
                  // Cambia el set de cursos visibles → limpiar selecciones de curso
                  setTitular({ ...titular, campaign: '', tipoCurso: '', horarioCurso: '' })
                  setBeneficiarios(prev => prev.map(b => ({ ...b, campaign: '', tipoCurso: '', horarioCurso: '' })))
                }}
                className="h-4 w-4 rounded border-red-400 text-red-600 focus:ring-red-500"
              />
              <span className="text-sm font-semibold">⏰ EXTEMPORÁNEA</span>
            </label>
          </div>
        </div>

        {/* Banner persistente cuando está marcado, para que el comercial no lo olvide */}
        {esContratoPrueba && (
          <div className="mb-4 bg-orange-50 border-l-4 border-orange-500 rounded-lg p-3 text-sm text-orange-800">
            <strong>Modo prueba activo.</strong> Este contrato se creará con número <code className="px-1 py-0.5 bg-orange-100 rounded text-orange-900">{contrato || 'PRB-...'}</code>, NO aparecerá en informes y podrá ser purgado en <em>Mantenimiento › Usuarios › Contratos Prueba</em>. Desmarca el checkbox si es real.
          </div>
        )}

        {/* Draft restore banner */}
        {showDraftBanner && (
          <div className="mb-6 bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-amber-800">Tienes un contrato en progreso</p>
              <p className="text-sm text-amber-600">
                {(() => {
                  const d = (window as any).__contractDraft
                  const name = d?.titular ? `${d.titular.primerNombre || ''} ${d.titular.primerApellido || ''}`.trim() : ''
                  const ago = d?.savedAt ? Math.round((Date.now() - d.savedAt) / 3600000) : 0
                  return name
                    ? `Para ${name} — guardado hace ${ago < 1 ? 'menos de 1 hora' : `${ago}h`}`
                    : `Guardado hace ${ago < 1 ? 'menos de 1 hora' : `${ago}h`}`
                })()}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={discardDraft}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Descartar
              </button>
              <button
                onClick={restoreDraft}
                className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700"
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex justify-between">
            {[1, 2, 3, 4, 5, 6, 7].map((step) => (
              <div
                key={step}
                className={`flex-1 ${step === 7 ? '' : 'border-b-2'} ${
                  step <= currentStep ? 'border-primary-600' : 'border-gray-200'
                } pb-4`}
              >
                <div
                  className={`w-10 h-10 mx-auto rounded-full flex items-center justify-center ${
                    step <= currentStep
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {step}
                </div>
                <p className="text-xs text-center mt-2">
                  {step === 1 && 'Asesor'}
                  {step === 2 && 'Datos básicos'}
                  {step === 3 && 'Ubicación'}
                  {step === 4 && 'Adicional'}
                  {step === 5 && 'Referencias'}
                  {step === 6 && 'Financiero'}
                  {step === 7 && 'Beneficiarios'}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Form steps */}
        <div className="bg-white shadow rounded-lg p-6">
          {/* Step 1: Asesor */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Información del Asesor</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Asesor creador del contrato *
                </label>
                <input
                  type="text"
                  value={titular.asesor}
                  onChange={(e) => setTitular({...titular, asesor: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Nombre del asesor"
                />
              </div>
            </div>
          )}

          {/* Step 2: Datos básicos */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Datos Básicos del Titular</h2>
              {/* Casillas: Impulsa + Titular beneficiario (misma línea) */}
              <div className="flex flex-wrap items-center gap-x-8 gap-y-2 mb-2">
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={titular.esCursoImpulsa}
                    onChange={(e) => {
                      const v = e.target.checked;
                      // Al cambiar Impulsa cambian los cursos válidos → limpiar selecciones de curso.
                      setTitular({ ...titular, esCursoImpulsa: v, campaign: '', tipoCurso: '', horarioCurso: '' });
                      setBeneficiarios(prev => prev.map(b => ({ ...b, campaign: '', tipoCurso: '', horarioCurso: '' })));
                    }}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-base font-semibold text-gray-900">¿Es curso Impulsa?</span>
                </label>
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    id="titularEsBeneficiario"
                    checked={titularEsBeneficiario}
                    onChange={(e) => setTitularEsBeneficiario(e.target.checked)}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-base font-semibold text-gray-900">¿Este titular será beneficiario? (tomará el curso)</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Primer nombre *
                  </label>
                  <input
                    type="text"
                    value={titular.primerNombre}
                    onChange={(e) => setTitular({...titular, primerNombre: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Segundo nombre
                  </label>
                  <input
                    type="text"
                    value={titular.segundoNombre}
                    onChange={(e) => setTitular({...titular, segundoNombre: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Primer apellido *
                  </label>
                  <input
                    type="text"
                    value={titular.primerApellido}
                    onChange={(e) => setTitular({...titular, primerApellido: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Segundo apellido
                  </label>
                  <input
                    type="text"
                    value={titular.segundoApellido}
                    onChange={(e) => setTitular({...titular, segundoApellido: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Número de identificación *
                  </label>
                  <input
                    type="text"
                    value={titular.numeroId}
                    onKeyDown={(e) => {
                      if (!/^[a-zA-Z0-9]$/.test(e.key) && !['Backspace','Delete','ArrowLeft','ArrowRight','Tab'].includes(e.key)) {
                        e.preventDefault()
                      }
                    }}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/[^A-Z0-9]/g, '').toUpperCase()
                      setTitular({...titular, numeroId: clean})
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    placeholder="Solo letras mayúsculas y números"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Plataforma *
                  </label>
                  <select
                    value={titular.plataforma}
                    onChange={(e) => setTitular({...titular, plataforma: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">Seleccionar...</option>
                    <option value="Chile">Chile</option>
                    <option value="Colombia">Colombia</option>
                    <option value="Ecuador">Ecuador</option>
                    <option value="Perú">Perú</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Número de contrato *
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={contrato}
                      onChange={(e) => setContrato(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                      placeholder={loadingContrato ? 'Generando...' : 'Seleccione plataforma para generar'}
                    />
                    {loadingContrato && (
                      <svg className="animate-spin h-5 w-5 text-gray-400 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                    )}
                  </div>
                </div>
                {titularEsBeneficiario && (
                  <div className="col-span-2 border-t border-gray-100 pt-4 mt-2">
                    <p className="text-sm font-semibold text-gray-700 mb-3">Curso del titular ({titular.esCursoImpulsa ? 'solo IMPULSA' : 'YOJI / OKINA / KODOMO / DANSHI / SENPAI'})</p>
                    <div className="grid grid-cols-3 gap-4">
                      <CursoCampaignFields
                        rows={cursosVisibles}
                        esImpulsa={titular.esCursoImpulsa}
                        userLogin={titular.userLogin}
                        values={{ campaign: titular.campaign, tipoCurso: titular.tipoCurso, horarioCurso: titular.horarioCurso }}
                        onPatch={(patch) => setTitular({ ...titular, ...patch })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Ubicación */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Ubicación</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fecha de nacimiento *
                  </label>
                  <input
                    type="date"
                    value={titular.fechaNacimiento}
                    onChange={(e) => setTitular({...titular, fechaNacimiento: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    País *
                  </label>
                  <select
                    value={titular.pais}
                    onChange={(e) => setTitular({...titular, pais: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  >
                    {COUNTRY_PREFIXES.map((country) => (
                      <option key={country.country} value={country.country}>
                        {country.country}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Domicilio *
                  </label>
                  <input
                    type="text"
                    value={titular.domicilio}
                    onChange={(e) => setTitular({...titular, domicilio: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Ciudad *
                  </label>
                  <input
                    type="text"
                    value={titular.ciudad}
                    onChange={(e) => setTitular({...titular, ciudad: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Celular * ({getPhonePrefix()})
                  </label>
                  <input
                    type="tel"
                    value={titular.celular}
                    onChange={(e) => setTitular({...titular, celular: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    placeholder="Número sin prefijo"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Teléfono fijo
                  </label>
                  <input
                    type="tel"
                    value={titular.telefono}
                    onChange={(e) => setTitular({...titular, telefono: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Información adicional */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Información Adicional</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Ingresos *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={titular.ingresos ? formatNumber(titular.ingresos) : ''}
                    onChange={(e) => handleNumericChange('ingresos', e.target.value, setTitular)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={titular.email}
                    onChange={(e) => setTitular({...titular, email: e.target.value})}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                      titular.email !== '' && !isValidEmail(titular.email) ? 'border-red-400' : 'border-gray-300'
                    }`}
                    placeholder="correo@dominio.com"
                  />
                  {titular.email !== '' && !isValidEmail(titular.email) && (
                    <p className="mt-1 text-xs text-red-600">Ingrese un correo válido (debe incluir @ y dominio).</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Empresa
                  </label>
                  <input
                    type="text"
                    value={titular.empresa}
                    onChange={(e) => setTitular({...titular, empresa: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cargo
                  </label>
                  <input
                    type="text"
                    value={titular.cargo}
                    onChange={(e) => setTitular({...titular, cargo: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Género *
                  </label>
                  <select
                    value={titular.genero}
                    onChange={(e) => setTitular({...titular, genero: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">Seleccione</option>
                    <option value="Masculino">Masculino</option>
                    <option value="Femenino">Femenino</option>
                    <option value="Otro">Otro</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Referencias */}
          {currentStep === 5 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Referencias</h2>
              <div className="space-y-6">
                <div>
                  <h3 className="font-medium text-gray-900 mb-3">Referencia 1 *</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nombre completo *
                      </label>
                      <input
                        type="text"
                        value={titular.referenciaUno}
                        onChange={(e) => setTitular({...titular, referenciaUno: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Parentesco *
                      </label>
                      <input
                        type="text"
                        value={titular.parentezcoRefUno}
                        onChange={(e) => setTitular({...titular, parentezcoRefUno: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Teléfono *
                      </label>
                      <input
                        type="tel"
                        value={titular.telRefUno}
                        onChange={(e) => setTitular({...titular, telRefUno: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-medium text-gray-900 mb-3">Referencia 2</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nombre completo
                      </label>
                      <input
                        type="text"
                        value={titular.referenciaDos}
                        onChange={(e) => setTitular({...titular, referenciaDos: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Parentesco
                      </label>
                      <input
                        type="text"
                        value={titular.parentezcoRefDos}
                        onChange={(e) => setTitular({...titular, parentezcoRefDos: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Teléfono
                      </label>
                      <input
                        type="tel"
                        value={titular.telRefDos}
                        onChange={(e) => setTitular({...titular, telRefDos: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 6: Información financiera */}
          {currentStep === 6 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Información Financiera</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Total del plan *
                  </label>
                  <input
                    type="text"
                    value={formatNumber(financial.totalPlan)}
                    onChange={(e) => {
                      const numericValue = Number(e.target.value.replace(/\D/g, ''));
                      handleNumericChange('totalPlan', e.target.value, setFinancial);
                      calculateBalance(numericValue, financial.pagoInscripcion);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Pago inscripción *
                  </label>
                  <input
                    type="text"
                    value={formatNumber(financial.pagoInscripcion)}
                    onChange={(e) => {
                      const numericValue = Number(e.target.value.replace(/\D/g, ''));
                      handleNumericChange('pagoInscripcion', e.target.value, setFinancial);
                      calculateBalance(financial.totalPlan, numericValue);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Saldo
                  </label>
                  <input
                    type="text"
                    value={formatNumber(financial.saldo)}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Número de cuotas / Tipo Plan
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={financial.numeroCuotas}
                      onChange={(e) => {
                        const numCuotas = Number(e.target.value);
                        setFinancial({...financial, numeroCuotas: numCuotas});
                        calculateInstallmentValue(financial.saldo, numCuotas);
                      }}
                      min="0"
                      max="99"
                      placeholder="Cuotas"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    />
                    <select
                      aria-label="Tipo Plan"
                      title="Tipo Plan"
                      value={financial.tipoPlan}
                      onChange={(e) => setFinancial({...financial, tipoPlan: e.target.value as any})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="">Tipo plan</option>
                      <option value="Contado">Contado</option>
                      <option value="Credito">Credito</option>
                      <option value="Colaborador">Colaborador</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Valor cuota
                  </label>
                  <input
                    type="text"
                    value={formatNumber(financial.valorCuota)}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fecha de pago *
                  </label>
                  <input
                    type="date"
                    value={financial.fechaPago}
                    onChange={(e) => setFinancial({...financial, fechaPago: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Vigencia * <span className="text-xs text-gray-400">(meses, 1–12)</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={financial.vigencia}
                    onKeyDown={(e) => {
                      // Block anything that is not a digit, backspace, delete, arrows or tab
                      if (!/^\d$/.test(e.key) && !['Backspace','Delete','ArrowLeft','ArrowRight','Tab'].includes(e.key)) {
                        e.preventDefault()
                      }
                    }}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, '')
                      if (raw === '') { setFinancial({...financial, vigencia: ''}); return }
                      const num = parseInt(raw, 10)
                      if (!isNaN(num) && num >= 1 && num <= 12) {
                        setFinancial({...financial, vigencia: String(num)})
                      }
                    }}
                    onBlur={(e) => {
                      const num = parseInt(e.target.value, 10)
                      if (isNaN(num) || num < 1) setFinancial({...financial, vigencia: '1'})
                      else if (num > 12)         setFinancial({...financial, vigencia: '12'})
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    placeholder="1 – 12"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Medio de pago *
                  </label>
                  <select
                    value={financial.medioPago}
                    onChange={(e) => setFinancial({...financial, medioPago: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">Seleccione</option>
                    {getPaymentOptions().map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 7: Beneficiarios */}
          {currentStep === 7 && (
            <div className="space-y-4">
              {/* Apoderado del contrato (en la fila del titular) */}
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <h2 className="text-xl font-semibold mb-3">Apoderado y Beneficiarios</h2>
                <label className="inline-flex items-center cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={titularEsApoderado}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setTitularEsApoderado(checked);
                      if (checked) {
                        setTitular((t) => ({
                          ...t,
                          apoderado: `${t.primerNombre} ${t.segundoNombre} ${t.primerApellido} ${t.segundoApellido}`.replace(/\s+/g, ' ').trim(),
                          apoderadoTelefono: getPhonePrefix() + (t.celular || ''),
                          apoderadoMail: t.email || '',
                        }));
                      }
                    }}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-base font-semibold text-gray-900">¿Titular será apoderado?</span>
                </label>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre apoderado *</label>
                    <input type="text" value={titular.apoderado} disabled={titularEsApoderado}
                      onChange={(e) => setTitular({ ...titular, apoderado: e.target.value })}
                      placeholder="Nombre del apoderado"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
                    <input type="tel" value={titular.apoderadoTelefono} disabled={titularEsApoderado}
                      onChange={(e) => setTitular({ ...titular, apoderadoTelefono: e.target.value })}
                      placeholder="Teléfono del apoderado"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
                    <input type="email" value={titular.apoderadoMail} disabled={titularEsApoderado}
                      onChange={(e) => setTitular({ ...titular, apoderadoMail: e.target.value })}
                      placeholder="correo@ejemplo.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100" />
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Beneficiarios</h3>
                <button
                  type="button"
                  onClick={addBeneficiario}
                  className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
                >
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Agregar Beneficiario
                </button>
              </div>

              {beneficiarios.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  No hay beneficiarios agregados. Puede agregar beneficiarios o continuar sin ellos.
                </p>
              ) : (
                <div className="space-y-6">
                  {beneficiarios.map((beneficiario, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="font-medium">Beneficiario {index + 1}</h3>
                        <button
                          type="button"
                          onClick={() => removeBeneficiario(index)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Primer nombre *</label>
                          <input
                            type="text"
                            value={beneficiario.primerNombre}
                            onChange={(e) => updateBeneficiario(index, 'primerNombre', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Segundo nombre</label>
                          <input
                            type="text"
                            value={beneficiario.segundoNombre}
                            onChange={(e) => updateBeneficiario(index, 'segundoNombre', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Primer apellido *</label>
                          <input
                            type="text"
                            value={beneficiario.primerApellido}
                            onChange={(e) => updateBeneficiario(index, 'primerApellido', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Segundo apellido</label>
                          <input
                            type="text"
                            value={beneficiario.segundoApellido}
                            onChange={(e) => updateBeneficiario(index, 'segundoApellido', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Número ID *</label>
                          <input
                            type="text"
                            value={beneficiario.numeroId}
                            onKeyDown={(e) => {
                              if (!/^[a-zA-Z0-9]$/.test(e.key) && !['Backspace','Delete','ArrowLeft','ArrowRight','Tab'].includes(e.key)) {
                                e.preventDefault()
                              }
                            }}
                            onChange={(e) => {
                              const clean = e.target.value.replace(/[^A-Z0-9]/g, '').toUpperCase()
                              updateBeneficiario(index, 'numeroId', clean)
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                            placeholder="Solo letras mayúsculas y números"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de nacimiento</label>
                          <input
                            type="date"
                            value={beneficiario.fechaNacimiento}
                            onChange={(e) => updateBeneficiario(index, 'fechaNacimiento', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                          <input
                            type="email"
                            value={beneficiario.email}
                            onChange={(e) => updateBeneficiario(index, 'email', e.target.value)}
                            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                              benefEmailError(index) ? 'border-red-400' : 'border-gray-300'
                            }`}
                          />
                          {benefEmailError(index) && (
                            <p className="mt-1 text-xs text-red-600">{benefEmailError(index)}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Celular * ({getPhonePrefix()})</label>
                          <input
                            type="tel"
                            value={beneficiario.celular}
                            onChange={(e) => updateBeneficiario(index, 'celular', e.target.value)}
                            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                              benefCelularWarn(index) ? 'border-amber-400' : 'border-gray-300'
                            }`}
                            placeholder="Número sin prefijo"
                          />
                          {benefCelularWarn(index) && (
                            <p className="mt-1 text-xs text-amber-600">⚠️ Mismo celular que el titular. Verifica que sea correcto.</p>
                          )}
                        </div>
                      </div>
                      <div className="border-t border-gray-100 pt-4 mt-4">
                        <p className="text-sm font-semibold text-gray-700 mb-3">Curso del beneficiario ({titular.esCursoImpulsa ? 'solo IMPULSA' : 'YOJI / OKINA / KODOMO / DANSHI / SENPAI'})</p>
                        <div className="grid grid-cols-3 gap-4">
                          <CursoCampaignFields
                            rows={cursosVisibles}
                            esImpulsa={titular.esCursoImpulsa}
                            userLogin={beneficiario.userLogin}
                            values={{ campaign: beneficiario.campaign, tipoCurso: beneficiario.tipoCurso, horarioCurso: beneficiario.horarioCurso }}
                            onPatch={(patch) => setBeneficiarios(prev => prev.map((b, i) => i === index ? { ...b, ...patch } : b))}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-md">
              {error}
            </div>
          )}

          {/* Success message */}
          {success && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 text-green-700 rounded-md">
              {success}
            </div>
          )}

          {/* Modal: advierte de la(s) casilla(s) no marcada(s) (Impulsa / titular-beneficiario) */}
          {showSinCursoModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span>⚠️</span> Confirma antes de continuar
                </h3>
                <div className="text-sm text-gray-600 space-y-3 mb-6">
                  {!titular.esCursoImpulsa && (
                    <p>No marcaste <b>"¿Es curso Impulsa?"</b>: ¿estás seguro de que <b>ningún beneficiario tomará un curso Impulsa</b>? (el contrato no será Impulsa).</p>
                  )}
                  {!titularEsBeneficiario && (
                    <p>El titular <b>no está marcado como beneficiario</b>: ¿estás seguro de que <b>no tomará ningún curso</b>? Solo quedará como responsable del contrato.</p>
                  )}
                </div>
                <div className="space-y-2">
                  {!titularEsBeneficiario && (
                    <button
                      type="button"
                      onClick={() => { setTitularEsBeneficiario(true); setShowSinCursoModal(false); }}
                      className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
                    >
                      Marcar al titular como beneficiario
                    </button>
                  )}
                  {!titular.esCursoImpulsa && (
                    <button
                      type="button"
                      onClick={() => {
                        setTitular({ ...titular, esCursoImpulsa: true, campaign: '', tipoCurso: '', horarioCurso: '' });
                        setBeneficiarios(prev => prev.map(b => ({ ...b, campaign: '', tipoCurso: '', horarioCurso: '' })));
                        setShowSinCursoModal(false);
                      }}
                      className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
                    >
                      Marcar como curso Impulsa
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setShowSinCursoModal(false); setCurrentStep(3); }}
                    className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg"
                  >
                    Aceptar y seguir
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSinCursoModal(false)}
                    className="w-full py-2 px-4 text-gray-400 hover:text-gray-600 text-sm"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal resumen antes de crear el contrato */}
          {showResumenModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-1">Resumen del contrato</h3>
                <p className="text-sm text-gray-500 mb-4">Revisa los datos antes de crear el contrato.</p>

                <div className="text-sm text-gray-700 space-y-4">
                  {/* Flags */}
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-semibold">N° {contrato || '—'}</span>
                    {esContratoPrueba && <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-xs font-semibold">🧪 Prueba</span>}
                    {esExtemporanea && <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs font-semibold">⏰ Extemporánea</span>}
                  </div>

                  {/* Titular */}
                  <div>
                    <p className="font-semibold text-gray-900">Titular</p>
                    <p>{`${titular.primerNombre} ${titular.segundoNombre} ${titular.primerApellido} ${titular.segundoApellido}`.replace(/\s+/g, ' ').trim()}</p>
                    <p className="text-gray-500">ID: {titular.numeroId} · {titular.plataforma}</p>
                    {titularEsBeneficiario && (
                      <p className="text-primary-700 mt-1">Toma el curso: <b>{titular.campaign} · {titular.tipoCurso} · {titular.horarioCurso}</b>{salonFor(titular.campaign, titular.tipoCurso, titular.horarioCurso) ? ` · Salón ${salonFor(titular.campaign, titular.tipoCurso, titular.horarioCurso)}` : ''}</p>
                    )}
                  </div>

                  {/* Apoderado */}
                  <div>
                    <p className="font-semibold text-gray-900">Apoderado</p>
                    <p>{titular.apoderado || '—'}{titularEsApoderado ? ' (el titular)' : ''}</p>
                    {(titular.apoderadoTelefono || titular.apoderadoMail) && (
                      <p className="text-gray-500">{titular.apoderadoTelefono || ''}{titular.apoderadoTelefono && titular.apoderadoMail ? ' · ' : ''}{titular.apoderadoMail || ''}</p>
                    )}
                  </div>

                  {/* Beneficiarios */}
                  <div>
                    <p className="font-semibold text-gray-900">Beneficiarios ({beneficiarios.length})</p>
                    {beneficiarios.length === 0 ? (
                      <p className="text-gray-500">{titularEsBeneficiario ? 'Solo el titular toma el curso.' : 'Sin beneficiarios.'}</p>
                    ) : (
                      <ul className="list-disc pl-5 space-y-1">
                        {beneficiarios.map((b, i) => (
                          <li key={i}>
                            {`${b.primerNombre} ${b.primerApellido}`.trim()} <span className="text-gray-500">(ID {b.numeroId})</span>
                            <span className="block text-gray-500">{b.campaign} · {b.tipoCurso} · {b.horarioCurso}{salonFor(b.campaign, b.tipoCurso, b.horarioCurso) ? ` · Salón ${salonFor(b.campaign, b.tipoCurso, b.horarioCurso)}` : ''}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                  <button type="button" onClick={() => setShowResumenModal(false)}
                    className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
                  <button type="button" onClick={handleSubmit} disabled={loading}
                    className="px-4 py-2 text-sm rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50">
                    {loading ? 'Creando...' : 'Confirmar y crear contrato'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="mt-6 flex justify-between">
            {currentStep > 1 && (
              <button
                type="button"
                onClick={handlePrevious}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                <ArrowLeftIcon className="h-4 w-4 mr-2" />
                Anterior
              </button>
            )}

            {currentStep < 7 ? (
              <button
                type="button"
                onClick={handleNext}
                className={`ml-auto inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 ${
                  currentStep === 1 ? 'w-full justify-center' : ''
                }`}
              >
                Siguiente
                <ArrowRightIcon className="h-4 w-4 ml-2" />
              </button>
            ) : (
              <button
                type="button"
                onClick={requestSubmit}
                disabled={loading}
                className="ml-auto inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creando...' : 'Crear Contrato'}
              </button>
            )}
          </div>
        </div>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  );
}