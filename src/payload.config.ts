// payload.config.ts
import { postgresAdapter } from '@payloadcms/db-postgres';
import { payloadCloudPlugin } from '@payloadcms/payload-cloud';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import path from 'path';
import { buildConfig, Payload } from 'payload';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { Users } from './collections/Users';
import { Media } from './collections/Media';
import { Tenants } from './collections/Tenant';
import { EncryptionOperations } from '@/collections/EncryptationOperation';
import { ResourceUsageDaily } from '@/collections/ResourcesUsage';
import { ErrorLogs } from '@/collections/ErrorLog';
import { aggregateResourceUsageDailyTask } from '@/cronjob/tasks/aggregateResourceUsageDailyTask';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

// 👇 Orígenes permitidos (sin slash final)
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://192.168.19.115:3000' // tu IP LAN que aparece en consola
];
const PROD_ORIGINS = [
  'http://190.105.244.71:90' // tu frontend en prod
];

const ORIGINS = process.env.NODE_ENV === 'production' ? PROD_ORIGINS : DEV_ORIGINS;

export default buildConfig({
  onInit: async (payload: Payload) => {
    // Aquí puedes realizar acciones al inicializar Payload
    payload.logger.info(`Servidor de Payload iniciado en ${process.env.NODE_ENV}`);
    // const x = await payload.jobs.queue({
    //   task: 'aggregate_resource_usage_daily',
    //   queue: 'nightly',
    //   input: { usage_date: '2025-08-21' }
    //   // opcional: forzar que esté listo para correr ya
    //   // waitUntil: new Date().toISOString(),
    // });
    // payload.logger.info('Job encolado:', x);
  },
  //http://190.105.244.71:90
  cors: ORIGINS,
  csrf: ORIGINS,
  jobs: {
    // 1) Registrar el TaskF
    tasks: [aggregateResourceUsageDailyTask],

    // 2) Runner en cron: procesa la cola `nightly`
    //    Nota: autoRun ejecuta jobs YA encolados (y por defecto también maneja los schedules).
    //    No usar en serverless. En serverless usar /api/payload-jobs/run o handle-schedules.
    autoRun: [{ cron: '* * * * *', queue: 'nightly', limit: 50 }]
  },
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
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
    },
    components: {
      graphics: {
        // 👉 apunta a TUS COMPONENTES .tsx (no a imágenes)
        Logo: './AdminLogo.tsx'
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
