import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-postgres';
import { redirect } from 'next/navigation';
import { queryOne } from '@/lib/postgres';

/**
 * Server Layout for /panel-advisor.
 * Checks if the ADVISOR has completed their profile update (perfilActualizado).
 * If not, redirects to /panel-advisor/actualizar-datos.
 * This runs on the Node.js server (not Edge) so it can query the DB.
 */
export default async function PanelAdvisorLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  const email = session?.user?.email;

  if (role === 'ADVISOR' && email) {
    // Check if advisor has completed profile update
    const ur = await queryOne<{ perfilActualizado: string | null }>(
      `SELECT "perfilActualizado" FROM "USUARIOS_ROLES" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
      [email]
    ).catch(() => null);

    if (ur && ur.perfilActualizado === null) {
      redirect('/panel-advisor/actualizar-datos');
    }
  }

  return <>{children}</>;
}
