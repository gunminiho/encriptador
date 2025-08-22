import { ScryptOptions } from 'node:crypto';

export type BinaryInput = ArrayBuffer | Uint8Array | Buffer;

export type BinaryLike =
  | ArrayBuffer
  | ArrayBufferView // Uint8Array, DataView, Buffer, etc.
  | Blob
  | ReadableStream<Uint8Array>;

export interface EncryptionResult {
  ok: number;
  missingPassword: number;
  failed: number;
  status: FileStatus[];
}

export const HWM = 1024 * 1024; // 1 MiB para todos los PassThrough (buen throughput)
export const CONCURRENCY = 8; // tareas de cifrado en paralelo (ajusta según CPU)
export const SALT_LEN = 16; // 128-bit
export const IV_LEN = 12; // 96-bit (recomendado para GCM)
export const TAG_LEN = 16; // 128-bit
export const keyLen = 32; // 256-bit
export const SCRYPT: ScryptOptions = { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const ZIP_LOG_STEP = 5 * 1024 * 1024;

export const EXTENSION_BLACKLIST = new Set([
  // Windows executables / instaladores
  'exe',
  'msi',
  'msp',
  'bat',
  'cmd',
  'com',
  'pif',
  'scr',
  'cpl',
  'msc',
  'sh',
  'cmd',
  'htm',
  // Scripts y macros
  'js',
  'jse',
  'vbs',
  'vbe',
  'wsf',
  'wsh',
  'hta',
  'ps1',
  'psm1',
  // Lenguajes interpretados / bytecode
  'py',
  'pyc',
  'rb',
  'pl',
  'php',
  'jar',
  // Librerías y módulos
  'dll',
  'so',
  'dylib',
  // Paquetes / contenedores que pueden ocultar código
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bz2',
  'apk',
  'app',
  'dmg',
  // tipo desconocido
  'unknown'
]);

export type PasswordMap = Map<string, string>;

export type FileStatus = { file: string; status?: 'error'; message: string } | { file: string; status: 'ok'; size: number } | { file: string; status: 'missing_password' };

export type NodeReadable = NodeJS.ReadableStream;

export interface ParsedMassiveRequest {
  files: AsyncGenerator<FileEntryStream, void, void>;
  passwords: PasswordMap;
  totalFiles: number;
  totalSizeBytes: number;
  passwordFile?: boolean; // Indica si se proporcionó un archivo CSV de contraseñas
  tempDir: string;
  fileList: FileEntryStream[]; // Para validaciones
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/** Lo mínimo que persistes a DB para la operación */
export type PayloadFileRequest = {
  name: string; // filename
  size: number; // size_bytes
  mimetype?: string; // opcional
  ext?: string; // opcional
};

/** Entrada que consume el cifrado (stream + metadata) */
export type FileEntryStream = {
  fieldname: string;
  filename: string;
  size?: number;
  mimetype?: string;
  ext?: string;
  /** Stream vivo que vas a cifrar (si prefieres fábrica, usa DiskFileHandle) */
  stream: NodeReadable;
  /** Ruta para limpiar */
  tmpPath: string | undefined;
};

export type FileOkEvent = { name: string; size: number; ext?: string; mimetype?: string };

export type MassivePipelineEvents = { on_file_ok?: (ev: FileOkEvent) => void };

export type FileTypeCount = Record<string, number>;
export interface UsageAccumulator {
  tenant_id: string;
  total_operations: number;
  encrypt_operations: number;
  decrypt_operations: number;
  total_mb_processed: number; // MB
  total_files_processed: number;
  failed_operations: number;
  sum_processing_time_ms: number;
  file_type_breakdown: Record<string, number>;
}

export interface AggregateDailyInput {
  /** Fecha en zona America/Lima (YYYY-MM-DD) a agregar.
   * Si no viene, se agrega "ayer" en Lima. */
  usage_date?: string;
}

export interface AggregateDailyOutput {
  usage_date_utc: string; // inicio de día UTC correspondiente a la fecha Lima agregada
  tenants_processed: number;
  docs_upserted: number;
}

export type AdminUser = { collection: 'users'; id: string; role: 'admin'; email?: string };

export type RegularUser = { collection: 'users'; id: string; role: 'user'; email?: string };

export type TenantAuth = { collection: 'tenants'; id: string; state?: boolean };

export type CpuInfo = { usagePercent: number };

export type MemInfo = { usedMB: number; totalMB: number; usagePercent: number };

export type DiskInfo = { readMBps?: number; writeMBps?: number; usedPercent?: number };

export type NetInfo = { rxKBps?: number; txKBps?: number };

export type SystemSnapshot = {
  at: string;
  cpu: CpuInfo;
  memory: MemInfo;
  disk: DiskInfo;
  network: NetInfo;
};

export interface SystemMetricsProvider {
  snapshot(): Promise<SystemSnapshot>;
}

export type OpType = 'encrypt' | 'decrypt';
export type OpsSnapshot = {
  windowSeconds: number;
  encryptCount: number;
  decryptCount: number;
  totalCount: number;
  at: string;
};
export interface OpsCounter {
  record(type: OpType): Promise<void> | void;
  snapshot(windowSeconds?: number): Promise<OpsSnapshot>;
}
