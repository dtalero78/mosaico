'use client'

import { Suspense, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

/**
 * Página PÚBLICA de bienvenida post-firma (`/bienvenida/[id]`).
 *
 * Destino del cliente al terminar de firmar el consentimiento en `/contrato/[id]`.
 * Agradece, deja constancia de la firma y explica el proceso de aprobación real
 * de MOSAICO (aprobación → enlace de perfil → activación → primera sesión).
 *
 * El acceso está acotado por el token de `bienvenida-token.ts`: sin él (o
 * vencido) el endpoint responde 403 y la página manda al sitio público.
 *
 * Identidad: paleta tomada del degradado real del logo (naranja #f39200 →
 * magenta #d3005b → morado #38009b) y Figtree, la tipografía de la marca.
 * Las clases van con prefijo `bv-` para no chocar con los estilos globales.
 */

const SITIO = 'https://mosaicosoroban.cl'

// Los tres canales de WhatsApp de MOSAICO (ver WhatsAppContacts del panel).
const CONTACTOS = [
  { label: 'Soporte Usuario', tel: '56979819760', display: '+56 9 7981 9760', principal: true },
  { label: 'Soporte Académico', tel: '56975482609', display: '+56 9 7548 2609', principal: false },
  { label: 'Finanzas', tel: '56982419141', display: '+56 9 8241 9141', principal: false },
]

const PASOS = [
  {
    estado: 'hecho' as const,
    titulo: 'Firmaste tu contrato',
    texto: 'Tu consentimiento quedó registrado con sello de integridad y validez legal.',
    chip: { clase: 'ok', texto: 'Completado' },
  },
  {
    estado: 'ahora' as const,
    titulo: 'Revisión y aprobación',
    texto: 'Nuestro equipo verifica tu contrato y los datos de cada alumno inscrito. Normalmente toma 48 horas hábiles.',
    chip: { clase: 'now', texto: 'En curso' },
  },
  {
    estado: '' as const,
    titulo: 'Llega el enlace para crear el perfil',
    texto: 'Enviamos un WhatsApp por cada alumno con su enlace personal. En los cursos de menores llega al apoderado registrado.',
    chip: null,
  },
  {
    estado: '' as const,
    titulo: 'Se habilita el acceso a la plataforma',
    texto: 'La cuenta se activa hasta una semana antes de que empiece el curso. Ahí aparecen el salón, el horario y el guía asignado.',
    chip: null,
  },
  {
    estado: '' as const,
    titulo: 'Primera sesión con tu guía',
    texto: 'Las clases son en vivo por Zoom, en el horario del salón. El enlace se abre cinco minutos antes de empezar.',
    chip: null,
  },
]

const PROGRAMA = [
  ['Sesiones', 'Clases en vivo con tu guía, en grupos reducidos y en el horario del salón que elegiste.'],
  ['Módulos', 'El curso avanza por módulos y lecciones, sumando una destreza nueva sobre la anterior.'],
  ['Talleres', 'Encuentros de práctica y olimpiadas para afianzar lo aprendido sin presión.'],
  ['Evaluaciones', 'Entrenamientos y evaluaciones dentro de la plataforma, con tus resultados a la vista.'],
  ['Material', 'Libro del curso y material interactivo, disponibles siempre en tu panel.'],
]

function BienvenidaContent() {
  const params = useParams()
  const titularId = params.id as string
  const token = useSearchParams().get('t') || ''

  const [nombre, setNombre] = useState('')
  const [contrato, setContrato] = useState('')
  const [documento, setDocumento] = useState('')
  const [fecha, setFecha] = useState('')
  const [hash, setHash] = useState('')
  const [tipoAprobacion, setTipoAprobacion] = useState('')
  const [denegado, setDenegado] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        // El endpoint exige el token: sin él (o vencido) responde 403 y no
        // devuelve ningún dato del titular.
        const res = await fetch(
          `/api/public/bienvenida/${titularId}?t=${encodeURIComponent(token)}`,
          { cache: 'no-store' },
        )
        const d = await res.json()
        if (cancelled) return
        if (!res.ok) { setDenegado(true); return }
        setNombre(d.nombre || '')
        setContrato(d.contrato || '')
        setDocumento(d.documento || '')
        setTipoAprobacion(d.tipoAprobacion || '')
        setHash(d.hashMasked || '')
        if (d.fechaFirma) {
          setFecha(new Date(d.fechaFirma).toLocaleString('es', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          }))
        }
      } catch {
        if (!cancelled) setDenegado(true)
      }
    }
    if (!token) { setDenegado(true); return }
    load()
    return () => { cancelled = true }
  }, [titularId, token])

  // Enlace vencido o sin llave: no mostramos datos, mandamos al sitio público.
  useEffect(() => {
    if (!denegado) return
    const t = setTimeout(() => { window.location.href = SITIO }, 4000)
    return () => clearTimeout(t)
  }, [denegado])

  if (denegado) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="bv-root" style={{ display: 'grid', placeItems: 'center', padding: '48px 24px' }}>
          <div style={{ maxWidth: '46ch', textAlign: 'center' }}>
            <h2 style={{ fontSize: 22 }}>Este enlace ya no está disponible</h2>
            <p style={{ color: 'var(--bv-tinta-suave)', marginTop: 10 }}>
              Por seguridad, la página de bienvenida solo puede abrirse durante un tiempo
              limitado después de firmar. Te llevamos a nuestro sitio…
            </p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" />

      <div className="bv-root">
        <header className="bv-hero">
          <div className="bv-hero-in">
            <div className="bv-marca">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="bv-logo" src="/logo-contrato.png" alt="MOSAICO" />
              <span className="bv-wordmark">MOSAICO</span>
            </div>
            <div className="bv-sello">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              Contrato firmado
            </div>
            <h1>
              Gracias por confiar en nosotros
              {nombre && <>, <span className="bv-nom">{nombre}</span></>}
            </h1>
            <p className="bv-bajada">
              Tu contrato quedó firmado y registrado. Desde ahora eres parte de MOSAICO,
              donde el cálculo mental con soroban se aprende paso a paso. Esto es lo que viene.
            </p>
          </div>
        </header>
        <div className="bv-filo" />

        <div className="bv-wrap">
          <section className="bv-acta" aria-label="Constancia de firma">
            <div className="bv-acta-cab">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Consentimiento declarativo verificado
            </div>
            <dl className="bv-acta-datos">
              {contrato && <div className="bv-dato"><dt>Contrato</dt><dd className="bv-mono">{contrato}</dd></div>}
              {fecha && <div className="bv-dato"><dt>Fecha y hora</dt><dd>{fecha}</dd></div>}
              {documento && <div className="bv-dato"><dt>Documento</dt><dd className="bv-mono">{documento}</dd></div>}
              <div className="bv-dato">
                <dt>Verificación</dt>
                <dd>{tipoAprobacion === 'AUTOMATICA' ? 'Aprobación administrativa' : 'WhatsApp · Código OTP'}</dd>
              </div>
              {hash && (
                <div className="bv-dato" style={{ gridColumn: '1/-1' }}>
                  <dt>Sello de integridad (SHA-256)</dt>
                  <dd className="bv-mono">{hash} <span className="bv-nota">(fragmento)</span></dd>
                </div>
              )}
            </dl>
          </section>

          <section>
            <p className="bv-rotulo">Proceso de aprobación</p>
            <h2>Qué sigue ahora</h2>
            <p className="bv-intro">
              Tu contrato entra al proceso de aprobación. Te acompañamos paso a paso hasta la
              primera sesión — no tienes que hacer nada por ahora.
            </p>

            <ol className="bv-pasos">
              {PASOS.map((p, i) => (
                <li key={p.titulo} className={`bv-paso ${p.estado}`}>
                  <span className="bv-cuenta" aria-hidden="true" />
                  <div>
                    <p className="bv-orden">Paso {i + 1}</p>
                    <h3>{p.titulo}</h3>
                    <p className="bv-texto">{p.texto}</p>
                    {p.chip && <span className={`bv-chip ${p.chip.clase}`}>{p.chip.texto}</span>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <p className="bv-rotulo">Tu programa</p>
            <h2>Lo que te espera</h2>
            <dl className="bv-programa">
              {PROGRAMA.map(([titulo, texto]) => (
                <div className="bv-fila" key={titulo}>
                  <dt>{titulo}</dt>
                  <dd>{texto}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="bv-cierre">
            <h2>Bienvenido a MOSAICO</h2>
            <p>
              Gracias por elegirnos para acompañarte en este camino. Si tienes cualquier duda
              mientras avanza tu aprobación, escríbenos: estamos para ayudarte.
            </p>
            <div className="bv-contacto">
              {CONTACTOS.map(c => (
                <a
                  key={c.tel}
                  className={`bv-btn ${c.principal ? 'bv-btn-a' : 'bv-btn-b'}`}
                  href={`https://wa.me/${c.tel}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {c.principal && (
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.4-.2-.6.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5 0-.2 0-.4 0-.5 0-.2-.6-1.5-.9-2.1-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.6 1.1 2.8c.1.2 1.8 2.9 4.5 4 .6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.4M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2" /></svg>
                  )}
                  {c.label} <span className="bv-tel">{c.display}</span>
                </a>
              ))}
            </div>
          </section>

          <footer className="bv-footer">
            <span>MOSAICO · Cálculo mental con soroban</span>
            <span>Este documento es tu constancia de firma. Consérvalo.</span>
          </footer>
        </div>
      </div>
    </>
  )
}

/**
 * useSearchParams() exige un boundary de Suspense en el App Router:
 * sin él, el build falla.
 */
export default function BienvenidaPage() {
  return (
    <Suspense fallback={null}>
      <BienvenidaContent />
    </Suspense>
  )
}

const CSS = `
.bv-root{
  /* Tomados del degradado real del logo: naranja -> magenta -> morado */
  --bv-naranja:#f39200; --bv-naranja-claro:#f6ac00; --bv-brasa:#f03500;
  --bv-magenta:#d3005b; --bv-morado:#38009b; --bv-morado-hondo:#240066;
  /* Neutros con sesgo morado, no gris puro */
  --bv-tinta:#1c1830; --bv-tinta-suave:#56506e; --bv-tenue:#8b84a3;
  --bv-ground:#ffffff; --bv-panel:#f8f6fc; --bv-linea:#e6e1f0;
  --bv-exito:#0f7a52; --bv-exito-fondo:#e8f6f0; --bv-exito-linea:#bfe3d3;
  --bv-acento-fila:#38009b; --bv-cuenta-off:#d6cee9;
  --bv-sombra:0 1px 2px rgba(28,24,48,.06),0 10px 28px -14px rgba(56,0,155,.22);

  background:var(--bv-ground);color:var(--bv-tinta);
  font-family:Figtree,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  font-size:16px;line-height:1.62;-webkit-font-smoothing:antialiased;
  min-height:100vh;
}
.bv-root *{box-sizing:border-box}
.bv-root h1,.bv-root h2,.bv-root h3{font-family:Figtree,sans-serif;text-wrap:balance;margin:0}

.bv-wrap{max-width:760px;margin:0 auto;padding:0 24px}

/* Portada: el degradado del abaco, con el naranja fuera del texto */
.bv-hero{background:linear-gradient(150deg,#240066 0%,#38009b 46%,#8a0a7d 78%,#c4005a 100%);
  color:#fff;position:relative;overflow:hidden}
.bv-hero::after{content:"";position:absolute;right:-120px;top:-150px;width:430px;height:430px;
  background:radial-gradient(circle,rgba(243,146,0,.38),transparent 68%);pointer-events:none}
.bv-hero-in{position:relative;z-index:1;padding:40px 24px 52px;max-width:760px;margin:0 auto}
.bv-marca{display:flex;align-items:center;gap:13px}
.bv-logo{height:46px;width:auto;display:block}
.bv-wordmark{font-weight:800;font-size:23px;letter-spacing:.13em;color:#fff}
.bv-sello{display:inline-flex;align-items:center;gap:9px;margin-top:32px;
  background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.32);
  color:#fff;border-radius:999px;padding:7px 15px 7px 11px;
  font-size:12.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}
.bv-sello svg{width:15px;height:15px;flex:none}
.bv-hero h1{font-size:clamp(31px,5.4vw,45px);font-weight:800;line-height:1.12;
  margin:18px 0 0;letter-spacing:-.022em;color:#fff}
.bv-nom{color:#ffc46b}
.bv-bajada{margin:16px 0 0;font-size:17.5px;line-height:1.6;color:rgba(255,255,255,.93);max-width:60ch}
/* Firma de marca: el degradado completo del logo como filo del encabezado */
.bv-filo{height:5px;background:linear-gradient(90deg,#f6ac00,#f03500 34%,#d3005b 62%,#38009b 100%)}

/* Constancia */
.bv-acta{background:var(--bv-panel);border:1px solid var(--bv-linea);border-radius:12px;
  box-shadow:var(--bv-sombra);margin:-26px auto 0;position:relative;z-index:2;max-width:712px}
.bv-acta-cab{display:flex;align-items:center;gap:9px;padding:15px 22px;
  border-bottom:1px solid var(--bv-linea);color:var(--bv-exito);font-weight:700;
  font-size:13px;letter-spacing:.06em;text-transform:uppercase}
.bv-acta-cab svg{width:17px;height:17px;flex:none}
.bv-acta-datos{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));
  gap:1px;background:var(--bv-linea);margin:0}
.bv-dato{background:var(--bv-panel);padding:15px 22px}
.bv-dato dt{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;
  color:var(--bv-tenue);margin:0}
.bv-dato dd{margin:6px 0 0;font-size:15px;font-weight:500;color:var(--bv-tinta);word-break:break-word}
.bv-mono{font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace;font-size:14px;
  font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.bv-nota{font-family:Figtree,sans-serif;font-size:11px;color:var(--bv-tenue);letter-spacing:.02em}

.bv-wrap section{padding:52px 0 0}
.bv-acta.bv-acta{padding-top:0}
.bv-rotulo{font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;
  color:var(--bv-magenta);margin:0 0 9px}
.bv-wrap h2{font-size:26px;font-weight:700;letter-spacing:-.018em}
.bv-intro{margin:11px 0 0;color:var(--bv-tinta-suave);max-width:62ch;font-size:16.5px}

/* Los pasos son cuentas ensartadas en la varilla de un soroban */
.bv-pasos{list-style:none;margin:32px 0 0;padding:0}
.bv-paso{display:grid;grid-template-columns:34px 1fr;gap:20px;position:relative;padding-bottom:28px}
.bv-paso:last-child{padding-bottom:0}
.bv-paso::before{content:"";position:absolute;left:16px;top:6px;bottom:-6px;width:2px;
  background:var(--bv-linea);border-radius:2px}
.bv-paso:last-child::before{display:none}
.bv-cuenta{width:34px;height:34px;position:relative;z-index:1;
  clip-path:polygon(50% 2%,100% 50%,50% 98%,0 50%);
  background:var(--bv-cuenta-off)}
.bv-paso.hecho .bv-cuenta{background:linear-gradient(140deg,var(--bv-naranja-claro),var(--bv-brasa))}
.bv-paso.ahora .bv-cuenta{background:linear-gradient(140deg,var(--bv-magenta),var(--bv-morado))}
.bv-paso.hecho::before{background:linear-gradient(180deg,var(--bv-brasa),var(--bv-magenta))}
.bv-paso.ahora::before{background:linear-gradient(180deg,var(--bv-magenta),var(--bv-linea))}
.bv-orden{font-size:10.5px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;
  color:var(--bv-tenue);margin:0}
.bv-paso h3{font-size:17.5px;font-weight:700;margin:3px 0 0;letter-spacing:-.012em}
.bv-texto{margin:6px 0 0;color:var(--bv-tinta-suave);font-size:15.5px;max-width:56ch}
.bv-chip{display:inline-block;margin:10px 0 0;font-size:11px;font-weight:700;letter-spacing:.07em;
  text-transform:uppercase;padding:3px 9px;border-radius:4px}
.bv-chip.ok{background:var(--bv-exito-fondo);color:var(--bv-exito);border:1px solid var(--bv-exito-linea)}
.bv-chip.now{background:rgba(211,0,91,.12);color:var(--bv-magenta);border:1px solid rgba(211,0,91,.3)}

.bv-programa{margin:28px 0 0;border-top:1px solid var(--bv-linea)}
.bv-fila{display:grid;grid-template-columns:132px 1fr;gap:20px;padding:15px 0;
  border-bottom:1px solid var(--bv-linea);align-items:baseline}
.bv-fila dt{font-weight:700;font-size:15px;color:var(--bv-acento-fila)}
.bv-fila dd{margin:0;color:var(--bv-tinta-suave);font-size:15.5px}

.bv-cierre{margin:52px 0 0;padding:32px 26px;border-radius:12px;
  background:linear-gradient(140deg,#240066,#38009b 55%,#8a0a7d 100%);color:#fff}
.bv-cierre h2{font-size:22px;color:#fff}
.bv-cierre p{margin:11px 0 0;color:rgba(255,255,255,.93);max-width:58ch;font-size:16px}
.bv-contacto{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 0}
.bv-btn{display:inline-flex;align-items:center;gap:8px;border-radius:8px;padding:11px 17px;
  font-weight:700;font-size:15px;text-decoration:none;
  transition:transform .15s ease,box-shadow .15s ease}
.bv-btn svg{width:17px;height:17px;flex:none}
.bv-btn-a{background:#fff;color:#240066}
.bv-btn-b{background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.34)}
.bv-btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px -6px rgba(0,0,0,.45)}
.bv-btn:focus-visible{outline:3px solid #f6ac00;outline-offset:2px}
.bv-tel{font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace;font-weight:500;
  font-size:13.5px;font-variant-numeric:tabular-nums;opacity:.85}

.bv-footer{margin:44px 0 0;border-top:1px solid var(--bv-linea);padding:22px 0 46px;
  color:var(--bv-tenue);font-size:13.5px;display:flex;flex-wrap:wrap;gap:6px 16px;
  justify-content:space-between}
@media (prefers-reduced-motion:reduce){.bv-root *{transition:none!important}}
@media (max-width:560px){
  .bv-fila{grid-template-columns:1fr;gap:3px}
  .bv-hero-in{padding:32px 20px 46px}
  .bv-acta{margin-left:4px;margin-right:4px}
  .bv-wordmark{font-size:20px}
  .bv-btn{width:100%;justify-content:center}
}
`
