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
    const { beneficiaryId, beneficiarioId } = body

    const id = beneficiaryId || beneficiarioId
    console.log('🗑️ [PostgreSQL] Deleting beneficiary:', id)

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'beneficiaryId is required' },
        { status: 400 }
      )
    }

    // Get numeroId before deleting to also remove from ACADEMICA
    const personResult = await query(
      `SELECT "numeroId" FROM "PEOPLE" WHERE "_id" = $1`,
      [id]
    )

    const numeroId = personResult.rows[0]?.numeroId

    // Borrar primero los bookings del estudiante. El vínculo booking→estudiante
    // es ACADEMICA._id, guardado en "studentId" (canónico) o "idEstudiante"
    // (legacy Wix); algunos bookings legacy además traen "numeroId". Se cubren
    // las tres rutas. (El bug previo usaba "visitorId", columna inexistente.)
    if (numeroId) {
      await query(
        `DELETE FROM "ACADEMICA_BOOKINGS"
         WHERE "studentId" IN (SELECT "_id" FROM "ACADEMICA" WHERE "numeroId" = $1)
            OR "idEstudiante" IN (SELECT "_id" FROM "ACADEMICA" WHERE "numeroId" = $1)
            OR "numeroId" = $1`,
        [numeroId]
      )

      // Delete from ACADEMICA
      await query(
        `DELETE FROM "ACADEMICA" WHERE "numeroId" = $1`,
        [numeroId]
      )
    }

    // Delete from PEOPLE
    const result = await query(
      `DELETE FROM "PEOPLE" WHERE "_id" = $1 RETURNING *`,
      [id]
    )

    if (result.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Beneficiary not found' },
        { status: 404 }
      )
    }

    console.log('✅ [PostgreSQL] Beneficiary deleted successfully')

    return NextResponse.json({
      success: true,
      message: 'Beneficiary deleted successfully'
    })

  } catch (error: any) {
    console.error('❌ Error in deleteBeneficiario:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete beneficiary', details: error.message },
      { status: 500 }
    )
  }
}
