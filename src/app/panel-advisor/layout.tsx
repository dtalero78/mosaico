import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-postgres';
import { redirect } from 'next/navigation';
import { queryOne } from '@/lib/postgres';

/**
 * Server Layout for /panel-advisor.
 * Redirects ADVISOR to /advisor-setup if perfilActualizado is NULL.
 * /advisor-setup lives outside this layout to avoid redirect loops.
 */
export default async function PanelAdvisorLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  const email = session?.user?.email;

  if (role === 'GUIA' && email) {
    const ur = await queryOne<{ perfilActualizado: string | null }>(
      `SELECT "perfilActualizado" FROM "USUARIOS_ROLES" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
      [email]
    ).catch(() => null);

    if (ur && ur.perfilActualizado === null) {
      redirect('/advisor-setup');
    }
  }

  return <>{children}</>;
}
