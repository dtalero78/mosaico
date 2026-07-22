import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

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

    // Format phone number for WhatsApp - remove ALL non-digit characters (including invisible Unicode)
    let formattedNumber = celular.toString().replace(/\D/g, '')

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
        'authorization': `Bearer ${process.env.WHAPI_TOKEN || 'I1s8u9FihgMttIDRvRDoMpOJB1LzPgtx'}`,
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