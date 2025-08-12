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
import { Payload } from 'payload';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
  onInit: async (payload: Payload) => {
    // Aquí puedes realizar acciones al inicializar Payload
    console.log('Servidor de Payload iniciado en: ', payload.config);
  },
  cors: '*',
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname)
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
