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
  onInit: async (payload) => {
    // Aquí puedes realizar acciones al inicializar Payload
    console.log('Payload inicializado');
    console.log(process.env.PAYLOAD_SECRET || 'No se ha configurado PAYLOAD_SECRET');
    console.log(process.env.DATABASE_URI || 'No se ha configurado DATABASE_URI');
  },
  cors: '*',
  // upload: {
  //   tempFileDir : TEMP_PATH,
  //   useTempFiles: true,
  //   limits:{
  //     fileSize: 25 * 1024 * 1024 // 25MB
  //   }
  //   // staticURL: '/uploads',        // no es admitido en v2
  //   // Puedes configurar limits, transform, etc. aquí
  // },
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname)
    }
    // components:{
    //   views: {
    //     dashboard : {
    //       Component : '../test.html'
    //     }
    //   }
    // }
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
