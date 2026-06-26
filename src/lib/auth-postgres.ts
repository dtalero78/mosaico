/**
 * Authentication Module with PostgreSQL
 * Priority: PostgreSQL → Wix → Test Users
 */

import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { queryOne } from './postgres'
import { isContractExpired } from './contract-expiry'

interface UserRole {
  _id: string
  email: string
  password: string
  nombre: string
  rol: string
  activo: boolean
}

/**
 * Verify user credentials against PostgreSQL.
 * Throws 'BLOCKED' if user is inactive (admin disabled).
 * Throws 'EXPIRED' if user is inactive due to expired contract.
 * Returns null for wrong password or user not found.
 */
async function verifyUserPostgres(email: string, password: string) {
  try {
    console.log('🔍 [PostgreSQL] Buscando usuario:', email);

    // El identificador puede ser el email (titulares/staff) o el userLogin
    // (estudiantes MOSAICO). Se busca por cualquiera de los dos.
    const user = await queryOne<UserRole>(
      `SELECT "_id", "email", "password", "nombre", "rol", "activo"
       FROM "USUARIOS_ROLES"
       WHERE "email" = $1 OR "userLogin" = $1`,
      [email]
    );

    if (!user) {
      console.log('⚠️ [PostgreSQL] Usuario no encontrado');
      return null;
    }

    // Look up the user's finalContrato from PEOPLE (TITULAR or BENEFICIARIO,
    // whichever has it). Match by email O userLogin (estudiantes entran por userLogin).
    const peopleRecord = await queryOne<{ finalContrato: string | null; rol?: string }>(
      `SELECT "finalContrato" FROM "PEOPLE"
       WHERE (LOWER("email") = LOWER($1) OR "userLogin" = $1) AND "finalContrato" IS NOT NULL
       ORDER BY "finalContrato" DESC LIMIT 1`,
      [email]
    );
    const contractExpired = isContractExpired(peopleRecord?.finalContrato);

    if (!user.activo) {
      console.log('⚠️ [PostgreSQL] Usuario inactivo — verificando motivo');
      if (contractExpired) {
        console.log('⚠️ [PostgreSQL] Contrato vencido:', peopleRecord?.finalContrato);
        throw new Error('EXPIRED');
      }
      throw new Error('BLOCKED');
    }

    // Defense in depth: even if USUARIOS_ROLES.activo is still true (e.g. cron
    // hasn't run yet, or PEOPLE/USUARIOS_ROLES got desynced), block ESTUDIANTE
    // login when their contract is past the +1 day grace window.
    if (user.rol === 'ESTUDIANTE' && contractExpired) {
      console.log('⚠️ [PostgreSQL] Estudiante con contrato vencido (activo aún true):', peopleRecord?.finalContrato);
      throw new Error('EXPIRED');
    }

    console.log('✅ [PostgreSQL] Usuario encontrado:', {
      email: user.email,
      rol: user.rol,
      activo: user.activo
    });

    // Verify password
    let isPasswordValid = false;

    if (user.password) {
      // Check if password is a bcrypt hash
      if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$') || user.password.startsWith('$2y$')) {
        console.log('🔐 [PostgreSQL] Verificando con bcrypt');
        isPasswordValid = await bcrypt.compare(password, user.password);
      } else {
        // Plain text comparison (legacy support)
        console.log('⚠️ [PostgreSQL] Contraseña en texto plano');
        console.log('🔍 [PostgreSQL] Comparando:', {
          inputLen: password.length,
          dbLen: user.password.length,
          match: password === user.password
        });
        isPasswordValid = password === user.password;
      }
    }

    if (isPasswordValid) {
      console.log('✅ [PostgreSQL] Login exitoso');
      return {
        id: user._id,
        email: user.email,
        name: user.nombre,
        role: user.rol,
      };
    } else {
      console.log('❌ [PostgreSQL] Contraseña incorrecta');
      return null;
    }
  } catch (error) {
    // Re-throw our custom errors so authorize() can propagate them to the client
    if (error instanceof Error && (error.message === 'BLOCKED' || error.message === 'EXPIRED')) {
      throw error;
    }
    console.error('❌ [PostgreSQL] Error:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Test users fallback (only used if PostgreSQL is not available)
 */
const testUsers = [
  {
    id: '1',
    email: 'superadmin@lgs.com',
    password: 'Test123!',
    name: 'Super Admin',
    role: 'SUPER_ADMIN',
  },
  {
    id: '2',
    email: 'admin@lgs.com',
    password: 'Test123!',
    name: 'Admin',
    role: 'ADMIN',
  },
  {
    id: '3',
    email: 'advisor@lgs.com',
    password: 'Test123!',
    name: 'Advisor',
    role: 'GUIA',
  },
  {
    id: '4',
    email: 'comercial@lgs.com',
    password: 'Test123!',
    name: 'Comercial',
    role: 'COMERCIAL',
  },
  {
    id: '5',
    email: 'aprobador@lgs.com',
    password: 'Test123!',
    name: 'Aprobador',
    role: 'APROBADOR',
  },
  {
    id: '6',
    email: 'd_talero@yahoo.com',
    password: 'Test123!',
    name: 'Talero',
    role: 'TALERO',
  },
  {
    id: '7',
    email: 'financiero@lgs.com',
    password: 'Test123!',
    name: 'Financiero',
    role: 'FINANCIERO',
  },
  {
    id: '8',
    email: 'servicio@lgs.com',
    password: 'Test123!',
    name: 'Servicio',
    role: 'SERVICIO',
  },
  {
    id: '9',
    email: 'readonly@lgs.com',
    password: 'Test123!',
    name: 'Solo Lectura',
    role: 'READONLY',
  },
];

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        console.log('🔍 Auth Debug:', {
          inputEmail: credentials.email,
        })

        // Check env-var admin fallback (for local dev)
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (adminEmail && adminPassword &&
            credentials.email === adminEmail && credentials.password === adminPassword) {
          console.log('✅ [EnvFallback] Admin login via env vars');
          return { id: 'env-admin', email: adminEmail, name: 'Super Admin', role: 'SUPER_ADMIN' };
        }

        // Try PostgreSQL
        const pgUser = await verifyUserPostgres(credentials.email, credentials.password);
        if (pgUser) {
          return pgUser;
        }

        console.log('❌ Auth failed - Invalid credentials');
        return null;
      }
    })
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        ;(session.user as any).id = token.sub
        ;(session.user as any).role = token.role
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
}
