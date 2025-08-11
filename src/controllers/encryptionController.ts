import type { PayloadRequest } from 'payload';
import type { PayloadFileRequest } from '@/custom-types';
import { EncryptionOperation } from '@/payload-types';
import { bytesToMB } from '@/utils/data_processing/converter';
import { handleError } from '@/utils/http/response';

export const createEncryptionResult = async (
  req: PayloadRequest,
  dataFiles: Array<PayloadFileRequest> | PayloadFileRequest,
  elapsedMs: number
): Promise<EncryptionOperation | Response> => {
  try {
    const doc = await req.payload.create({
      collection: 'encryption_operations',
      data: {
        tenant_id: req.user?.id as string,
        operation_type: 'encrypt',
        file_count: Array.isArray(dataFiles) ? dataFiles.length : 1,
        total_size_mb: bytesToMB(Array.isArray(dataFiles) ? dataFiles.reduce((sum, f) => sum + f.size, 0) : dataFiles.size),
        file_types: Array.isArray(dataFiles) ? dataFiles.map((f) => f.name.split('.').pop()?.toLowerCase()) : [dataFiles.name.split('.').pop()?.toLowerCase()],
        processing_time_ms: elapsedMs,
        encryption_method: 'AES-256-GCM',
        success: true,
        operation_timestamp: new Date().toISOString()
      }
    });
    return doc;
  } catch (error: unknown) {
    return handleError(error, 'Error en la creación de registro de encriptación masiva', 'encrypt');
  }
};
