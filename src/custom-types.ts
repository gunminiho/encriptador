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
  fileName: string;
  blob: Buffer | Uint8Array | ArrayBuffer; // ajusta al tipo real que devuelves
  salt?: Uint8Array;
  iv?: Uint8Array;
}

export interface DecryptionResult {
  fileName: string;
  blob: ArrayBuffer;
  elapsedMs: number;
}

export const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 64 * 1024 * 1024 };
export const SALT_LEN: number = 16;
export const IV_LEN: number = 12;
export const TAG_LEN = 16;

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

export const words = [
  'cielo',
  'gato',
  'sol',
  'tren',
  'luna',
  'verde',
  'flor',
  'río',
  'nube',
  'mar',
  'fuego',
  'campo',
  'piedra',
  'frío',
  'arena',
  'perro',
  'café',
  'rojo',
  'roca',
  'nieve',
  'casa',
  'bosque',
  'viento',
  'canción',
  'montaña',
  'rayo',
  'laguna',
  'estrella',
  'libro',
  'noche',
  'puente',
  'jardín',
  'hoja',
  'rastro',
  'silencio',
  'camino',
  'risa',
  'tarde',
  'barco',
  'sal',
  'lago',
  'metal',
  'lluvia',
  'oro',
  'hierro',
  'cuerda',
  'pluma',
  'palma',
  'caracol',
  'pájaro',
  'madera',
  'vela',
  'cuerda',
  'puerta',
  'piedra',
  'humo',
  'árbol',
  'llama',
  'faro',
  'pan',
  'vino',
  'aceite',
  'gota',
  'arena',
  'marea',
  'brisa',
  'nido',
  'puerto',
  'isla',
  'cosecha',
  'mundo',
  'llanura',
  'pescador',
  'nave',
  'tormenta',
  'orilla',
  'acero',
  'acantilado',
  'flamenco',
  'cascada',
  'guitarra',
  'ladrillo',
  'mirada',
  'trigo',
  'sombra',
  'luz',
  'fresco',
  'cobre',
  'alba',
  'crepúsculo',
  'poema',
  'canto',
  'espiga',
  'colina',
  'campana',
  'lucero',
  'techo',
  'pared',
  'sabana',
  'valle',
  'astro',
  'muralla',
  'parque',
  'puñado',
  'finca',
  'molino',
  'charco',
  'río',
  'avenida',
  'lienzo',
  'cántaro',
  'farol',
  'ancla',
  'zafiro',
  'pasto',
  'coral',
  'marfil',
  'loto',
  'sierra',
  'florero',
  'barro',
  'arena',
  'ladera',
  'bisagra',
  'horizonte',
  'planicie',
  'huerto',
  'melodía'
];
