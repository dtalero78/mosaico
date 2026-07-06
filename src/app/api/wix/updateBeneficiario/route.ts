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
    const { beneficiaryId, visitorId, ...updateFields } = body

    const id = beneficiaryId || visitorId
    console.log('🔄 [PostgreSQL] Updating beneficiary:', id, updateFields)

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'beneficiaryId or visitorId is required' },
        { status: 400 }
      )
    }

    // Build dynamic update query
    const allowedFields = [
      'primerNombre', 'segundoNombre', 'primerApellido', 'segundoApellido',
      'email', 'celular', 'fechaNacimiento', 'nivel', 'step',
      'nivelParalelo', 'stepParalelo', 'plataforma', 'observaciones',
      'direccion', 'ciudad', 'pais'
    ]

    const updates: string[] = []
    const values: any[] = []
    let paramIndex = 1

    for (const field of allowedFields) {
      if (updateFields[field] !== undefined) {
        updates.push(`"${field}" = $${paramIndex}`)
        values.push(updateFields[field])
        paramIndex++
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      )
    }

    // Add _updatedDate and the ID
    updates.push(`"_updatedDate" = NOW()`)
    values.push(id)

    const result = await query(
      `UPDATE "PEOPLE"
       SET ${updates.join(', ')}
       WHERE "_id" = $${paramIndex}
       RETURNING *`,
      values
    )

    if (result.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Beneficiary not found' },
        { status: 404 }
      )
    }

    // Also update ACADEMICA if nivel/step changed
    if (updateFields.nivel || updateFields.step) {
      const person = result.rows[0]
      await query(
        `UPDATE "ACADEMICA"
         SET "nivel" = COALESCE($2, "nivel"),
             "step" = COALESCE($3, "step"),
             "primerNombre" = COALESCE($4, "primerNombre"),
             "primerApellido" = COALESCE($5, "primerApellido"),
             "_updatedDate" = NOW()
         WHERE "numeroId" = $1`,
        [
          person.numeroId,
          updateFields.nivel || null,
          updateFields.step || null,
          updateFields.primerNombre || null,
          updateFields.primerApellido || null
        ]
      )
    }

    console.log('✅ [PostgreSQL] Beneficiary updated successfully')

    return NextResponse.json({
      success: true,
      message: 'Beneficiary updated successfully',
      person: result.rows[0]
    })

  } catch (error: any) {
    console.error('❌ Error in updateBeneficiario:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update beneficiary', details: error.message },
      { status: 500 }
    )
  }
}
