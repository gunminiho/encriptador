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

export interface SimpleFileLike {
  name: string;
  size: number;
}

export type UploadRequestContext = {
  request_id: string;
  temp_dir: string;
};

export type DiskFileHandle = {
  /** Nombre original saneado (con extensión) */
  filename: string;
  /** Ruta absoluta al archivo temporal en disco */
  tmp_path: string;
  /** Tamaño en bytes (stat al terminar de escribir) */
  size_bytes: number;
  /** Mimetype detectado (sniff o por extensión) */
  mimetype?: string;
  /** Extensión en minúsculas, sin punto (ej: 'pdf') */
  ext?: string;
  /** Campo form-data del que provino (opcional) */
  field_name?: string;

  /** Crear un Readable fresco desde tmp_path (evita guardar un stream ya consumido) */
  openReadStream(): NodeReadable;
};

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

// export type MassivePipelineEvents = {
//   on_file_ok?: (file: { name: string; size: number; ext?: string; mimetype?: string }) => void;
// };

export type FileOkEvent = { name: string; size: number; ext?: string; mimetype?: string };
export type MassivePipelineEvents = { on_file_ok?: (ev: FileOkEvent) => void };

export type MassivePipelineResult = {
  webStream: ReadableStream; // lo que ya devuelves
  stop: () => void; // lo que ya tienes
  done: Promise<void>; // 🔥 NUEVO: se resuelve cuando el ZIP cierra
};

export type FileTypeCount = Record<string, number>;
