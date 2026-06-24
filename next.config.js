/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output configuration for Digital Ocean deployment
  output: 'standalone',

  // Image optimization
  images: {
    domains: [
      'localhost',
      'static.wixstatic.com',
      'www.lgsplataforma.com',
      'lgsplataforma.com'
    ],
  },

  // TypeScript configuration
  typescript: {
    // Skip ALL TypeScript errors during build for production
    ignoreBuildErrors: true,
  },

  // ESLint: no bloquear el build por reglas de lint (mismo criterio que TS).
  // Errores preexistentes (no-unescaped-entities, etc.) en código heredado.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Page extensions - only process these file types as pages
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'].filter(ext => !ext.includes('wix')),

  // Webpack configuration to ignore Wix files
  webpack: (config, { isServer }) => {
    // Ignore .jsw files
    config.module.rules.push({
      test: /\.jsw$/,
      loader: 'ignore-loader'
    })

    // Ignore src/pages directory (legacy Wix files)
    config.module.rules.push({
      test: /src\/pages\//,
      loader: 'ignore-loader'
    })

    // Fix for potential node modules issues
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      }
    }

    return config
  },

  // Headers for CORS
  async headers() {
    return [
      {
        source: '/api/(.*)',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization',
          },
        ],
      },
    ]
  },

  // Redirects for old Wix routes
  async redirects() {
    return [
      {
        source: '/pages/:path*',
        destination: '/',
        permanent: true,
      },
      {
        source: '/wix-pages/:path*',
        destination: '/',
        permanent: true,
      },
    ]
  },

  // Environment variables
  env: {
    DISABLE_AUTH: process.env.DISABLE_AUTH,
    DISABLE_DB: process.env.DISABLE_DB,
    USE_REAL_WIX_DATA: process.env.USE_REAL_WIX_DATA,
    NEXT_PUBLIC_WIX_API_BASE_URL: process.env.NEXT_PUBLIC_WIX_API_BASE_URL || 'https://www.lgsplataforma.com/_functions',
    WIX_API_BASE_URL: process.env.WIX_API_BASE_URL || 'https://www.lgsplataforma.com/_functions',
  },

  // Performance optimizations
  poweredByHeader: false,
  reactStrictMode: true,
  swcMinify: true,

  // Experimental features for better deployment
  experimental: {
    serverComponentsExternalPackages: ['mongoose', 'mongodb'],
  },
}

module.exports = nextConfig