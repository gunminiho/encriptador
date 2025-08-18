import { ScryptOptions } from 'node:crypto';

export type PayloadFileRequest = {
  /**
   * Context of the file when it was uploaded via client side.
   */
  clientUploadContext?: unknown;
  data: Buffer;
  mimetype: string;
  name: string;
  size: number;
  tempFilePath?: string;
  fieldName?: string;
};

export type MassiveEncryptionRequest = {
  csvFile: PayloadFileRequest;
  dataFiles: Array<PayloadFileRequest>;
};

export type SingleEncryptionRequest = {
  file: PayloadFileRequest;
  password: string;
};

export type MassiveEncryptionResult = {
  zipStream: ReadableStream<Uint8Array>;
  elapsedMs: number;
};

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

export interface DecryptionResult {
  fileName: string;
  blob: ArrayBuffer;
  elapsedMs: number;
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

export type FileEntryStream = { fieldname: string; filename: string; mimetype: string; stream: NodeReadable; tmpPath?: string };

export type GcmMeta = { salt: Buffer; iv: Buffer; tag: Buffer; size: number };

export type ZipManifestRecord = {
  file_name: string;
  size_bytes: number;
  salt_b64: string;
  iv_b64: string;
  tag_b64: string;
  error?: string;
};

export type FileStatus = { file: string; status?: 'error'; message: string } | { file: string; status: 'ok'; size: number } | { file: string; status: 'missing_password' };

export type NodeReadable = NodeJS.ReadableStream;

export interface ParsedMassiveRequest {
  files: AsyncGenerator<FileEntryStream, void, void>;
  passwords: PasswordMap;
  totalFiles: number;
  totalSizeBytes: number;
  tempDir: string;
  fileList: FileEntryStream[]; // Para validaciones
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}
