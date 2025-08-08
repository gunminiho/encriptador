// src/collections/EncryptionOperations.ts
import { PayloadRequest } from 'payload';
import { v4 as uuidv4 } from 'uuid';
import { addDataAndFileToRequest } from 'payload';
import { encryptFileGCM } from '@/services/encryption';
import { response } from '@/utils/http/response';

// ==========================================
// 🔧 INTERFACES Y TIPOS (Dependency Inversion)
// ==========================================

interface IAuthenticationService {
  validateApiKey(headers: Headers, user: any): Promise<boolean>;
}

interface IFileProcessor {
  extractFilesFromRequest(req: PayloadRequest): Promise<ProcessedFiles>;
}

interface ICsvParser {
  parsePasswordMap(csvContent: string): Map<string, string>;
}

interface IEncryptionService {
  encryptFile(fileData: Buffer, password: string, fileName: string): Promise<EncryptedFile>;
}

interface IMultipartBuilder {
  buildMultipartResponse(encryptedFiles: EncryptedFile[]): MultipartResponse;
}

interface IOperationLogger {
  logEncryptionOperation(req: PayloadRequest, operation: EncryptionOperationData): Promise<void>;
}

// ==========================================
// 🎯 TIPOS DE DOMINIO
// ==========================================

interface ProcessedFiles {
  csvFile: FileData;
  dataFiles: FileData[];
}

interface FileData {
  name: string;
  data: Buffer;
  size: number;
}

interface EncryptedFile {
  fileName: string;
  blob: Buffer;
  originalName: string;
}

interface MultipartResponse {
  body: Buffer;
  boundary: string;
}

interface EncryptionOperationData {
  fileCount: number;
  totalSizeMb: number;
  fileTypes: string[];
  processingTimeMs: number;
  success: boolean;
}

// ==========================================
// 🔐 VALIDADORES (Single Responsibility)
// ==========================================

class FileValidator {
  static validateCsvPresence(csvFile: FileData | undefined): void {
    if (!csvFile) {
      throw new ValidationError('Falta passwords.csv', 'CSV_MISSING');
    }
  }

  static validateMinimumFiles(dataFiles: FileData[]): void {
    if (dataFiles.length < 2) {
      throw new ValidationError('Se necesitan ≥2 archivos para encriptación masiva', 'INSUFFICIENT_FILES');
    }
  }

  static validatePasswordMapping(dataFiles: FileData[], passwordMap: Map<string, string>): void {
    const missingPasswords = dataFiles.filter((file) => !passwordMap.has(file.name));

    if (missingPasswords.length > 0) {
      const missingFileNames = missingPasswords.map((f) => f.name).join(', ');
      throw new ValidationError(`Faltan passwords para: ${missingFileNames}`, 'MISSING_PASSWORDS');
    }
  }
}

// ==========================================
// 🚨 EXCEPCIONES PERSONALIZADAS
// ==========================================

class ValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

class AuthenticationError extends Error {
  constructor(message: string = 'No autorizado') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

// ==========================================
// 🔑 SERVICIOS (Single Responsibility + Dependency Inversion)
// ==========================================

class AuthenticationService implements IAuthenticationService {
  async validateApiKey(headers: Headers, user: any): Promise<boolean> {
    const auth = headers.get('Authorization') || '';
    return auth.includes('API-Key') && !!user;
  }
}

class FileProcessorService implements IFileProcessor {
  async extractFilesFromRequest(req: PayloadRequest): Promise<ProcessedFiles> {
    await addDataAndFileToRequest(req);

    const allFiles = Array.isArray(req.file) ? req.file : [req.file].filter(Boolean);
    const csvFile = allFiles.find((f) => f.name === 'passwords.csv');
    const dataFiles = allFiles.filter((f) => f.name !== 'passwords.csv');

    return {
      csvFile: csvFile ? this.mapToFileData(csvFile) : undefined!,
      dataFiles: dataFiles.map((file) => this.mapToFileData(file))
    };
  }

  private mapToFileData(file: any): FileData {
    return {
      name: file.name,
      data: Buffer.from(file.data),
      size: file.size || file.data.length
    };
  }
}

class CsvParserService implements ICsvParser {
  parsePasswordMap(csvContent: string): Map<string, string> {
    const passwordMap = new Map<string, string>();

    const lines = csvContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      const [fileName, password] = line.split(';').map((part) => part.trim());

      if (fileName && password) {
        passwordMap.set(fileName, password);
      }
    }

    return passwordMap;
  }
}

class MultipartBuilderService implements IMultipartBuilder {
  buildMultipartResponse(encryptedFiles: EncryptedFile[]): MultipartResponse {
    const boundary = `ENC-MULTI-${uuidv4()}`;
    const parts: Buffer[] = [];

    for (const file of encryptedFiles) {
      // Headers de la parte
      const partHeaders = [
        `--${boundary}`,
        `Content-Disposition: attachment; filename="${file.fileName}"`,
        `Content-Type: application/octet-stream`,
        '' // Línea vacía requerida por RFC
      ].join('\r\n');

      parts.push(Buffer.from(partHeaders));
      parts.push(file.blob);
      parts.push(Buffer.from('\r\n'));
    }

    // Cierre del multipart
    //parts.push(Buffer.from(`--${boundary}--\r\n`));

    return {
      body: Buffer.concat(parts),
      boundary
    };
  }
}

class OperationLoggerService implements IOperationLogger {
  async logEncryptionOperation(req: PayloadRequest, operation: EncryptionOperationData): Promise<void> {
    await req.payload.create({
      collection: 'encryption_operations',
      data: {
        tenant_id: req.user ? req.user.id : '',
        operation_type: 'encrypt',
        file_count: operation.fileCount,
        total_size_mb: operation.totalSizeMb,
        file_types: operation.fileTypes,
        processing_time_ms: operation.processingTimeMs,
        encryption_method: 'AES-256-GCM',
        success: operation.success,
        operation_timestamp: new Date().toISOString()
      }
    });
  }
}

// ==========================================
// 🎭 FACADE PATTERN - Orquestador Principal
// ==========================================

class MassiveEncryptionFacade {
  constructor(
    private readonly authService: IAuthenticationService,
    private readonly fileProcessor: IFileProcessor,
    private readonly csvParser: ICsvParser,
    private readonly encryptionService: IEncryptionService,
    private readonly multipartBuilder: IMultipartBuilder,
    private readonly operationLogger: IOperationLogger
  ) {}

  async execute(req: PayloadRequest): Promise<Response> {
    const startTime = performance.now();

    try {
      // 1️⃣ Autenticación
      await this.validateAuthentication(req);

      // 2️⃣ Procesamiento de archivos
      const { csvFile, dataFiles } = await this.fileProcessor.extractFilesFromRequest(req);

      // 3️⃣ Validaciones de negocio
      this.validateBusinessRules(csvFile, dataFiles);

      // 4️⃣ Parseo del CSV de passwords
      const passwordMap = this.csvParser.parsePasswordMap(csvFile.data.toString('utf-8'));

      // 5️⃣ Validación de mapping completo
      FileValidator.validatePasswordMapping(dataFiles, passwordMap);

      // 6️⃣ Encriptación masiva
      const encryptedFiles = await this.encryptFiles(dataFiles, passwordMap);

      // 7️⃣ Construcción de respuesta multipart
      const multipartResponse = this.multipartBuilder.buildMultipartResponse(encryptedFiles);

      // 8️⃣ Logging de operación
      const processingTime = performance.now() - startTime;
      await this.logOperation(req, dataFiles, processingTime, true);

      // 9️⃣ Respuesta final
      return new Response(multipartResponse.body, {
        status: 200,
        headers: {
          'Content-Type': `multipart/mixed; boundary=${multipartResponse.boundary}`,
          'Content-Length': multipartResponse.body.length.toString()
        }
      });
    } catch (error) {
      // 🚨 Manejo centralizado de errores
      const processingTime = performance.now() - startTime;
      await this.handleError(req, error, processingTime);

      return this.buildErrorResponse(error);
    }
  }

  private async validateAuthentication(req: PayloadRequest): Promise<void> {
    const isValid = await this.authService.validateApiKey(req.headers, req.user);
    if (!isValid) {
      throw new AuthenticationError();
    }
  }

  private validateBusinessRules(csvFile: FileData, dataFiles: FileData[]): void {
    FileValidator.validateCsvPresence(csvFile);
    FileValidator.validateMinimumFiles(dataFiles);
  }

  private async encryptFiles(dataFiles: FileData[], passwordMap: Map<string, string>): Promise<EncryptedFile[]> {
    const encryptionPromises = dataFiles.map(async (file) => {
      const password = passwordMap.get(file.name)!;
      const result = await this.encryptionService.encryptFile(file.data, password, file.name);

      return {
        ...result,
        originalName: file.name
      };
    });

    return Promise.all(encryptionPromises);
  }

  private async logOperation(req: PayloadRequest, dataFiles: FileData[], processingTime: number, success: boolean): Promise<void> {
    const operationData: EncryptionOperationData = {
      fileCount: dataFiles.length,
      totalSizeMb: dataFiles.reduce((sum, f) => sum + f.size, 0),
      fileTypes: dataFiles.map((f) => f.name.split('.').pop()?.toLowerCase() || 'unknown'),
      processingTimeMs: Math.round(processingTime),
      success
    };

    try {
      await this.operationLogger.logEncryptionOperation(req, operationData);
    } catch (logError) {
      console.error('Error logging operation:', logError);
      // No propagamos el error de logging para no afectar la operación principal
    }
  }

  private async handleError(req: PayloadRequest, error: any, processingTime: number): Promise<void> {
    console.error('Massive encryption error:', error);

    // Log del error si es posible
    try {
      await this.logOperation(req, [], processingTime, false);
    } catch (logError) {
      console.error('Error logging failed operation:', logError);
    }
  }

  private buildErrorResponse(error: any): Response {
    if (error instanceof ValidationError) {
      return response(
        error.statusCode,
        {
          error: error.message,
          code: error.code
        },
        'Validation Error'
      );
    }

    if (error instanceof AuthenticationError) {
      return response(
        401,
        {
          error: error.message
        },
        'Authentication Error'
      );
    }

    return response(
      500,
      {
        error: 'Error interno del servidor'
      },
      'Internal Server Error'
    );
  }
}

// ==========================================
// 🏭 FACTORY PATTERN - Inyección de Dependencias
// ==========================================

class MassiveEncryptionFactory {
  static create(): MassiveEncryptionFacade {
    return new MassiveEncryptionFacade(
      new AuthenticationService(),
      new FileProcessorService(),
      new CsvParserService(),
      // Usamos el servicio de encriptación existente como adapter
      {
        async encryptFile(fileData: Buffer, password: string, fileName: string): Promise<EncryptedFile> {
          const result = await encryptFileGCM(fileData, password, fileName);
          return {
            fileName: result.fileName,
            blob: Buffer.from(result.blob),
            originalName: fileName
          };
        }
      },
      new MultipartBuilderService(),
      new OperationLoggerService()
    );
  }
}

// ==========================================
// 🎯 ENDPOINT PRINCIPAL - Ultra Simplificado
// ==========================================

export const massiveEncryption = async (req: PayloadRequest): Promise<Response> => {
  const facade = MassiveEncryptionFactory.create();
  return facade.execute(req);
};

// ==========================================
// 🧪 UTILIDADES PARA TESTING
// ==========================================

// Exportamos las clases para facilitar unit testing
export {
  FileValidator,
  AuthenticationService,
  FileProcessorService,
  CsvParserService,
  MultipartBuilderService,
  OperationLoggerService,
  MassiveEncryptionFacade,
  ValidationError,
  AuthenticationError
};
