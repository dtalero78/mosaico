import 'server-only';
import https from 'https';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';

// En dev (Node sin CA del sistema, certificados locales rotos, etc.) saltamos
// la verificación TLS sólo para el cliente de Spaces. En producción se mantiene
// estricta. Variable opcional DO_SPACES_INSECURE_TLS=1 fuerza el bypass.
const isProd = process.env.NODE_ENV === 'production';
const forceInsecure = process.env.DO_SPACES_INSECURE_TLS === '1';
const skipTlsVerify = forceInsecure || !isProd;

const requestHandler = skipTlsVerify
  ? new NodeHttpHandler({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    })
  : undefined;

export const spacesClient = new S3Client({
  endpoint: process.env.DO_SPACES_ENDPOINT || 'https://sfo3.digitaloceanspaces.com',
  region: process.env.DO_SPACES_REGION || 'sfo3',
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY || '',
    secretAccessKey: process.env.DO_SPACES_SECRET || '',
  },
  forcePathStyle: false,
  ...(requestHandler ? { requestHandler } : {}),
});

export const SPACES_BUCKET = process.env.DO_SPACES_BUCKET || 'lgs-bucket';
export const SPACES_CDN = `https://${SPACES_BUCKET}.${process.env.DO_SPACES_REGION || 'sfo3'}.digitaloceanspaces.com`;

/**
 * Generate a presigned URL for a private video file.
 * @param key - Object key in the bucket, e.g. "videos/bn1-step1.mp4"
 * @param expiresInSeconds - URL validity (default: 2 hours)
 */
export async function getPresignedVideoUrl(
  key: string,
  expiresInSeconds = 7200
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key });
  return getSignedUrl(spacesClient, command, { expiresIn: expiresInSeconds });
}
