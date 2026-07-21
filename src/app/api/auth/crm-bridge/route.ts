import { NextRequest, NextResponse } from 'next/server'
import { encode } from 'next-auth/jwt'
import crypto from 'crypto'

const CRM_BRIDGE_SECRET = process.env.CRM_BRIDGE_SECRET || ''
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || ''
const BASE_URL = process.env.NEXTAUTH_URL || 'https://lgs-plataforma.com'
const TOKEN_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes

function verifyHmac(email: string, ts: string, token: string): boolean {
  if (!CRM_BRIDGE_SECRET) return false
  const expected = crypto
    .createHmac('sha256', CRM_BRIDGE_SECRET)
    .update(`${email}:${ts}`)
    .digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  const ts = searchParams.get('ts')
  const token = searchParams.get('token')
  const redirect = searchParams.get('redirect') || '/dashboard/comercial/crear-contrato'
  // Nombre y apellido del asesor enviados por el CRM. NO forman parte del HMAC
  // (la firma sigue siendo `${email}:${ts}`); sólo prellenan el formulario de
  // contrato, así que no necesitan ir firmados.
  const nombre = searchParams.get('nombre') || ''
  const apellido = searchParams.get('apellido') || ''

  if (!email || !ts || !token) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
  }

  // Verify timestamp is not expired
  const timestamp = parseInt(ts, 10)
  if (isNaN(timestamp) || Date.now() - timestamp > TOKEN_MAX_AGE_MS) {
    return NextResponse.json({ error: 'Token expired' }, { status: 401 })
  }

  // Verify HMAC signature
  if (!verifyHmac(email, ts, token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  // Create a NextAuth-compatible JWT session token
  const sessionToken = await encode({
    token: {
      sub: `crm-bridge-${email}`,
      email,
      name: `CRM Asesor`,
      role: 'COMERCIAL',
    },
    secret: NEXTAUTH_SECRET,
  })

  // Build redirect URL with email param using the public base URL
  const redirectUrl = new URL(redirect, BASE_URL)
  redirectUrl.searchParams.set('email', email)
  if (nombre) redirectUrl.searchParams.set('nombre', nombre)
  if (apellido) redirectUrl.searchParams.set('apellido', apellido)

  const response = NextResponse.redirect(redirectUrl)

  // Set the NextAuth session cookie
  // In production (HTTPS), NextAuth uses __Secure- prefix
  const isSecure = BASE_URL.startsWith('https')
  const cookieName = isSecure
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token'

  response.cookies.set(cookieName, sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 60, // 30 minutes session
  })

  return response
}
