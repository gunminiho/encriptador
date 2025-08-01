// storage-adapter-import-placeholder
import { postgresAdapter } from '@payloadcms/db-postgres'
import { payloadCloudPlugin } from '@payloadcms/payload-cloud'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Tenants } from './collections/Tenant'
import { EncryptionOperations } from '@/collections/EncryptationOperation'
import { ResourceUsageDaily } from '@/collections/ResourcesUsage'
import { ErrorLogs } from '@/collections/ErrorLog'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  // onInit: async (ctx: Payload) => {
  //   // ctx.express es la instancia de Express
  //   console.log("payload: ",ctx);
  //   //ctx.express.post('/encrypt', encryptHandler)
  //   // Si necesitas un endpoint de descifrado:
  //   // ctx.express.post('/decrypt', decryptHandler);
  // },
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
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
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    idType: 'uuid',
    pool: {
      connectionString: process.env.DATABASE_URI || '',
    },
  }),
  sharp,
  plugins: [
    payloadCloudPlugin(),
    // storage-adapter-placeholder
  ],
})
