// storage-adapter-import-placeholder
import { postgresAdapter } from '@payloadcms/db-postgres';
import { payloadCloudPlugin } from '@payloadcms/payload-cloud';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import path from 'path';
import { buildConfig } from 'payload';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { Users } from './collections/Users';
import { Media } from './collections/Media';
import { Tenants } from './collections/Tenant';
import { EncryptionOperations } from '@/collections/EncryptationOperation';
import { ResourceUsageDaily } from '@/collections/ResourcesUsage';
import { ErrorLogs } from '@/collections/ErrorLog';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
  onInit: async () => {
    // Aquí puedes realizar acciones al inicializar Payload
    console.log('Servidor de Payload iniciado');
  },
  cors: '*',
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) }, // ok dejarlo así
    meta: {
      title: 'Omn Admin',
      titleSuffix: ' — Encriptador',
      description: 'Panel de administración del encriptador OMN',
      icons: [{ rel: 'icon', url: '/assets/omn_logo.svg' }],
      openGraph: {
        siteName: 'OMN Admin',
        title: 'OMN Admin',
        description: 'Panel de administración del encriptador OMN',
        images: [{ url: '/assets/omn_logo.svg', width: 1200, height: 630 }]
      },
      robots: 'noindex, nofollow'
      // opcional:
      // defaultOGImageType: 'dynamic' | 'static' | 'off',
    },
    components: {
      graphics: {
        // 👉 apunta a TUS COMPONENTES .tsx (no a imágenes)
        Logo: './AdminLogo.tsx'
        // Icon: '/components/Favicon.tsx'
      }
    }
  },
  collections: [Users, Media, Tenants, EncryptionOperations, ResourceUsageDaily, ErrorLogs],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts')
  },
  db: postgresAdapter({
    idType: 'uuid',
    pool: {
      connectionString: process.env.DATABASE_URI || ''
    }
  }),
  sharp,
  plugins: [
    payloadCloudPlugin()
    // storage-adapter-placeholder
  ]
});
