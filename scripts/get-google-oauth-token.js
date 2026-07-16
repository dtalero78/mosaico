/**
 * Obtiene el REFRESH TOKEN de Google para subir contratos a Drive.
 *
 * Por qué OAuth y no la cuenta de servicio: la carpeta de contratos vive en "Mi
 * unidad" de una cuenta Gmail. Desde 2021 Google exige que todo archivo tenga un
 * dueño con cuota, y una cuenta de servicio tiene 0 bytes → al crear el archivo
 * (que le pertenecería a ella) la subida se rechaza, aunque la carpeta esté
 * compartida como Editor. Con OAuth la app actúa COMO el usuario: los PDFs quedan
 * a su nombre y contra sus 15 GB.
 *
 * Antes de correrlo, en Google Cloud Console (mismo proyecto de la llave):
 *   1. APIs y servicios → Pantalla de consentimiento de OAuth
 *      - Tipo: Externo
 *      - Datos de contacto/soporte: el correo dueño de la carpeta
 *      - PUBLICAR la app ("Publicar app" → En producción). IMPORTANTE: si queda
 *        en "Prueba", el refresh token CADUCA A LOS 7 DÍAS y los contratos
 *        dejarían de subirse sin aviso.
 *   2. APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth
 *      - Tipo de aplicación: App de escritorio
 *      - Copiar el Client ID y el Client Secret
 *
 * Uso:
 *   node scripts/get-google-oauth-token.js <CLIENT_ID> <CLIENT_SECRET>
 *
 * Abre una URL, se inicia sesión con la cuenta DUEÑA de la carpeta, y el script
 * imprime el refresh token. No guarda nada en disco ni en el repo.
 */
const http = require('http');
const { google } = require('googleapis');

const [CLIENT_ID, CLIENT_SECRET] = process.argv.slice(2);
const PORT = 53682; // puerto del loopback registrado por el cliente "App de escritorio"
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Uso: node scripts/get-google-oauth-token.js <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, `http://localhost:${PORT}`);

const url = oauth2.generateAuthUrl({
  access_type: 'offline',   // necesario para que devuelva refresh_token
  prompt: 'consent',        // fuerza el refresh_token aunque ya se haya autorizado antes
  scope: SCOPES,
});

console.log('\n1) Abre esta URL e inicia sesión con la cuenta DUEÑA de la carpeta:\n');
console.log(url);
console.log('\n2) Si aparece "Google no ha verificado esta aplicación":');
console.log('   → Configuración avanzada → Ir a <nombre> (no seguro). Es tu propia app.');
console.log('\nEsperando la autorización...\n');

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('code');
  if (!code) { res.end('Sin código.'); return; }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.end('Listo. Puedes cerrar esta pestaña y volver a la terminal.');
    console.log('✅ Autorizado.\n');
    if (tokens.refresh_token) {
      console.log('REFRESH TOKEN (cárgalo como GOOGLE_OAUTH_REFRESH_TOKEN):\n');
      console.log(tokens.refresh_token);
      console.log('\nGuárdalo ya: Google no lo vuelve a mostrar.');
    } else {
      console.log('⚠ No llegó refresh_token. Revoca el acceso en');
      console.log('  https://myaccount.google.com/permissions y repite.');
    }
  } catch (e) {
    console.log('❌ Error al canjear el código:', e.message);
  } finally {
    server.close();
    process.exit(0);
  }
});
server.listen(PORT);
