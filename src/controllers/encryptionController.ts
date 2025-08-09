import type { PayloadRequest } from 'payload';
import type { PayloadFileRequest } from '@/utils/http/requestProcesses';
import { EncryptionOperation } from '@/payload-types';
import { bytesToMB } from '@/utils/data_processing/converter';

export const createEncryptionResult = async (req: PayloadRequest, dataFiles: Array<PayloadFileRequest>, elapsedMs: number): Promise<EncryptionOperation | Response> => {
  // 6️⃣ Registrar operación masiva
  try {
    const doc = await req.payload.create({
      collection: 'encryption_operations',
      data: {
        tenant_id: req.user?.id as string,
        operation_type: 'encrypt',
        file_count: dataFiles.length,
        total_size_mb: bytesToMB(dataFiles.reduce((sum, f) => sum + f.size, 0)),
        file_types: dataFiles.map((f) => f.name.split('.').pop()?.toLowerCase()),
        processing_time_ms: elapsedMs,
        encryption_method: 'AES-256-GCM',
        success: true,
        operation_timestamp: new Date().toISOString()
      }
    });
    return doc;
  } catch (error: any) {
    console.error('Error en la creación de registro de encriptación masiva: ', error.message);
    throw new Error('DB_CREATE_ENCRYPTION_OPERATION_FAILED');
  }
};
