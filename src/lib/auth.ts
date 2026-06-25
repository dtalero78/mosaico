import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'

interface UserRole {
  _id: string
  email: string
  password: string
  nombre: string
  rol: string
  activo: boolean
}

async function verifyUserFromAPI(email: string): Promise<UserRole | null> {
  try {
    // Use internal API to verify credentials
    // This avoids importing pg directly which causes client-side bundling issues
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3001';
    const response = await fetch(`${baseUrl}/api/internal/verify-credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      console.error('❌ [Auth API] Response not ok:', response.status);
      return null;
    }

    const data = await response.json();

    if (data.success && data.user) {
      return data.user;
    }

    return null;
  } catch (error) {
    console.error('❌ [Auth API] Error:', error);
    return null;
  }
}

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

        // STEP 1: Verify user exists and is active in PostgreSQL via internal API
        try {
          console.log('🔍 [PostgreSQL] Buscando usuario:', credentials.email);

          const user = await verifyUserFromAPI(credentials.email);

          if (user && user.activo) {
            console.log('✅ [PostgreSQL] Usuario encontrado:', {
              email: user.email,
              rol: user.rol,
              activo: user.activo
            });

            // STEP 2: Verify password (supports both bcrypt hash and plain text)
            if (user.password) {
              let isPasswordValid = false;

              // Check if password is a bcrypt hash (starts with $2a$, $2b$, or $2y$)
              if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$') || user.password.startsWith('$2y$')) {
                // Use bcrypt comparison for hashed passwords
                console.log('🔐 [PostgreSQL] Verificando contraseña con bcrypt hash');
                isPasswordValid = await bcrypt.compare(credentials.password, user.password);
              } else {
                // Direct comparison for plain text passwords (legacy support)
                console.log('⚠️ [PostgreSQL] Contraseña en texto plano detectada');
                isPasswordValid = credentials.password === user.password;
              }

              if (isPasswordValid) {
                console.log(`✅ [PostgreSQL] Login exitoso: ${user.rol}`);
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
            } else {
              console.log('⚠️ [PostgreSQL] Usuario no tiene contraseña configurada');
              return null;
            }
          } else if (user && !user.activo) {
            console.log('⚠️ [PostgreSQL] Usuario inactivo');
            return null;
          } else {
            console.log('⚠️ [PostgreSQL] Usuario no encontrado');
            // Continue to fallback test users
          }
        } catch (error) {
          console.error('❌ [PostgreSQL] Error:', error);
          console.error('❌ Error details:', error instanceof Error ? error.message : String(error));
          // Continue to fallback test users
        }

        // FALLBACK: Use hardcoded test users if PostgreSQL is not available
        console.log('⚠️ Usando usuarios de prueba locales (PostgreSQL no disponible)');

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

        const user = testUsers.find(
          (u) => u.email === credentials.email && u.password === credentials.password
        );

        if (user) {
          console.log(`✅ ${user.role} auth successful (fallback)`);
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          };
        }

        // Check legacy admin from env vars (lowercase 'admin' role)
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@lgs.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';

        if (credentials.email === adminEmail && credentials.password === adminPassword) {
          console.log('✅ Legacy admin auth successful');
          return {
            id: 'legacy-admin',
            email: adminEmail,
            name: 'Admin (Legacy)',
            role: 'admin', // lowercase for backwards compatibility
          };
        }

        console.log('❌ Auth failed');
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

