import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/postgres'
import { cursoUsaApoderadoParaMensajes } from '@/lib/welcome-modulo'

/**
 * Resuelve el teléfono destino del mensaje (bienvenida / link de perfil).
 * Para cursos de menores (YOJI/OKINA/KODOMO/DANSHI) el mensaje va al APODERADO
 * del propio beneficiario; para el resto (SENPAI/IMPULSA) va al `celular` recibido.
 * beneficiarioId puede ser un PEOPLE._id (prs_) o un ACADEMICA._id (acd_).
 * Best-effort: ante cualquier fallo se conserva el `celular` original.
 */
async function resolverDestino(beneficiarioId: string, celularOriginal: string): Promise<{ numero: string; usoApoderado: boolean }> {
  const fallback = { numero: celularOriginal, usoApoderado: false };
  try {
    // 1) beneficiarioId como PEOPLE._id (caso sin-registro)
    let row = (await query(
      `SELECT "tipoCurso", "apoderadoTelefono" FROM "PEOPLE" WHERE "_id" = $1 LIMIT 1`,
      [beneficiarioId]
    )).rows[0] as { tipoCurso?: string; apoderadoTelefono?: string } | undefined;

    // 2) si no, beneficiarioId como ACADEMICA._id → resolver PEOPLE por numeroId (prefiere BENEFICIARIO)
    if (!row) {
      row = (await query(
        `SELECT p."tipoCurso", p."apoderadoTelefono"
           FROM "ACADEMICA" a
           JOIN LATERAL (
             SELECT "tipoCurso", "apoderadoTelefono" FROM "PEOPLE" p2
             WHERE p2."numeroId" = a."numeroId"
             ORDER BY CASE WHEN p2."tipoUsuario"='BENEFICIARIO' THEN 0 ELSE 1 END
             LIMIT 1
           ) p ON true
          WHERE a."_id" = $1 LIMIT 1`,
        [beneficiarioId]
      )).rows[0] as { tipoCurso?: string; apoderadoTelefono?: string } | undefined;
    }

    if (!row || !cursoUsaApoderadoParaMensajes(row.tipoCurso)) return fallback;

    const apoderadoDigitos = String(row.apoderadoTelefono || '').replace(/\D/g, '');
    if (apoderadoDigitos.length < 10) return fallback; // apoderado sin teléfono válido → al alumno
    return { numero: apoderadoDigitos, usoApoderado: true };
  } catch {
    return fallback;
  }
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const wixSecret = request.headers.get('x-wix-secret');
  if (process.env.WIX_SECRET && wixSecret === process.env.WIX_SECRET) return true;
  const session = await getServerSession(authOptions);
  return !!session;
}

export async function POST(request: NextRequest) {
  if (!await isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json()
    const { celular, beneficiarioId, nombre, noWelcome } = body

    console.log('📱 Welcome WhatsApp API Request:', { celular, beneficiarioId, nombre, noWelcome })

    if (!celular || !beneficiarioId) {
      console.error('❌ Missing required fields:', { celular: !!celular, beneficiarioId: !!beneficiarioId })
      return NextResponse.json(
        { success: false, error: 'Phone number and beneficiario ID are required' },
        { status: 400 }
      )
    }

    // Menores (YOJI/OKINA/KODOMO/DANSHI) → el mensaje va al APODERADO del beneficiario.
    const { numero: destino, usoApoderado } = await resolverDestino(beneficiarioId, celular.toString())
    console.log(usoApoderado ? '👨‍👧 Enviando al APODERADO (curso de menores)' : '🙋 Enviando al alumno')

    // Format phone number for WhatsApp - remove ALL non-digit characters (including invisible Unicode)
    let formattedNumber = destino.replace(/\D/g, '')

    // Ensure the number has proper length
    if (formattedNumber.length < 10) {
      console.error('❌ Phone number too short:', formattedNumber)
      return NextResponse.json(
        { success: false, error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    const registroUrl = `${process.env.APP_URL || 'https://mosaicosorobanplataforma.com'}/nuevo-usuario/${beneficiarioId}${noWelcome ? '?noWelcome=1' : ''}`

    // Create welcome message (similar to line 1061 in FICHA ADMINISTRATIVO)
    const message = `Hola ${nombre || ''} 👋:\n\n*¡Eres parte de MOSAICO!* 🎉 \n\nPara terminar tu registro y crear tu usuario sigue este enlace:\n\n${registroUrl}\n\nSi tienes alguna pregunta, no dudes en contactarnos.\n\n¡Bienvenido a la familia MOSAICO! 🚀`

    console.log('📤 Sending Welcome WhatsApp to:', formattedNumber)

    // Send WhatsApp message using Whapi.cloud
    const whatsappResponse = await fetch('https://gate.whapi.cloud/messages/text', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${process.env.WHAPI_TOKEN || 'h2vjBWeG8csEl45GIuKgOr5pvGwCVTbu'}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        typing_time: 0,
        to: formattedNumber,
        body: message
      })
    })

    const responseText = await whatsappResponse.text()
    console.log('📨 WhatsApp API Response:', whatsappResponse.status, responseText.substring(0, 200))

    if (!whatsappResponse.ok) {
      console.error('❌ WhatsApp API error:', whatsappResponse.status, responseText)

      let errorDetails = responseText
      try {
        const errorJson = JSON.parse(responseText)
        errorDetails = errorJson.message || errorJson.error || responseText
      } catch (e) {
        // Keep original text if not JSON
      }

      return NextResponse.json(
        {
          success: false,
          error: `WhatsApp API error: ${errorDetails}`,
          details: {
            status: whatsappResponse.status,
            message: errorDetails
          }
        },
        { status: 500 }
      )
    }

    let whatsappData
    try {
      whatsappData = JSON.parse(responseText)
    } catch (e) {
      console.error('⚠️ Could not parse WhatsApp response as JSON')
      whatsappData = { response: responseText }
    }

    console.log('✅ Welcome WhatsApp sent successfully to', nombre || 'beneficiario')

    return NextResponse.json({
      success: true,
      message: 'Welcome WhatsApp message sent successfully',
      data: whatsappData
    })

  } catch (error: any) {
    console.error('❌ Error sending Welcome WhatsApp message:', error)
    console.error('Error details:', error.message, error.stack)

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to send Welcome WhatsApp message',
        details: error.toString()
      },
      { status: 500 }
    )
  }
}