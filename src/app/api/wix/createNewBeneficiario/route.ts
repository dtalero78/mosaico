import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/postgres'

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const wixSecret = request.headers.get('x-wix-secret');
  if (process.env.WIX_SECRET && wixSecret === process.env.WIX_SECRET) return true;
  const session = await getServerSession(authOptions);
  if (!session) return false;
  // P0-4: bloquea roles no-staff (ESTUDIANTE/GUIA) — no pueden mutar datos de terceros.
  const role = (session.user as any)?.role;
  return !!role && role !== 'ESTUDIANTE' && role !== 'GUIA';
}

export async function POST(request: NextRequest) {
  if (!await isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json()

    console.log('➕ [PostgreSQL] Creating new beneficiary:', body)

    // Validate required fields
    if (!body.numeroId || !body.primerNombre || !body.primerApellido) {
      return NextResponse.json(
        { success: false, error: 'numeroId, primerNombre, and primerApellido are required' },
        { status: 400 }
      )
    }

    // Check if numeroId already exists
    const existingResult = await query(
      `SELECT "_id" FROM "PEOPLE" WHERE "numeroId" = $1 AND "tipoUsuario" = 'BENEFICIARIO'`,
      [body.numeroId]
    )

    if (existingResult.rowCount && existingResult.rowCount > 0) {
      return NextResponse.json(
        { success: false, error: `Beneficiary with numeroId ${body.numeroId} already exists` },
        { status: 409 }
      )
    }

    // Generate unique ID
    const personId = `per_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Insert into PEOPLE
    const insertResult = await query(
      `INSERT INTO "PEOPLE" (
        "_id", "numeroId", "primerNombre", "segundoNombre",
        "primerApellido", "segundoApellido", "email", "celular",
        "fechaNacimiento", "tipoUsuario", "contrato", "nivel", "step",
        "plataforma", "aprobacion", "estadoInactivo",
        "origen", "_createdDate", "_updatedDate"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'BENEFICIARIO', $10, $11, $12, $13, 'Pendiente', false,
        'POSTGRES', NOW(), NOW()
      )
      RETURNING *`,
      [
        personId,
        body.numeroId,
        body.primerNombre,
        body.segundoNombre || null,
        body.primerApellido,
        body.segundoApellido || null,
        body.email || null,
        body.celular || null,
        body.fechaNacimiento || null,
        body.contrato || null,
        body.nivel || null,
        body.step || null,
        body.plataforma || null
      ]
    )

    // Also create ACADEMICA record if nivel is provided
    if (body.nivel && body.step) {
      const academicId = `aca_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      await query(
        `INSERT INTO "ACADEMICA" (
          "_id", "numeroId", "primerNombre", "segundoNombre",
          "primerApellido", "segundoApellido", "email", "celular",
          "nivel", "step", "plataforma", "estadoInactivo",
          "_createdDate", "_updatedDate"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, NOW(), NOW()
        )`,
        [
          academicId,
          body.numeroId,
          body.primerNombre,
          body.segundoNombre || null,
          body.primerApellido,
          body.segundoApellido || null,
          body.email || null,
          body.celular || null,
          body.nivel,
          body.step,
          body.plataforma || null
        ]
      )
    }

    console.log('✅ [PostgreSQL] Beneficiary created successfully:', personId)

    return NextResponse.json({
      success: true,
      message: 'Beneficiary created successfully',
      person: insertResult.rows[0],
      personId
    })

  } catch (error: any) {
    console.error('❌ Error in createNewBeneficiario:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create beneficiary', details: error.message },
      { status: 500 }
    )
  }
}
