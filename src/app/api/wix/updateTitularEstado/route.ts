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
    const { personId, nuevoEstado } = body

    if (!personId || !nuevoEstado) {
      return NextResponse.json(
        { success: false, error: 'personId and nuevoEstado are required' },
        { status: 400 }
      )
    }

    console.log('🔄 [PostgreSQL] Updating titular estado:', { personId, nuevoEstado })

    // Update PEOPLE table - set aprobacion to new estado
    const result = await query(
      `UPDATE "PEOPLE"
       SET "aprobacion" = $2, "_updatedDate" = NOW()
       WHERE "_id" = $1
       RETURNING *`,
      [personId, nuevoEstado]
    )

    if (result.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Titular not found' },
        { status: 404 }
      )
    }

    console.log('✅ [PostgreSQL] Titular estado updated successfully')

    return NextResponse.json({
      success: true,
      message: 'Titular estado updated successfully',
      person: result.rows[0]
    })

  } catch (error: any) {
    console.error('❌ Error in updateTitularEstado:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update titular estado', details: error.message },
      { status: 500 }
    )
  }
}
