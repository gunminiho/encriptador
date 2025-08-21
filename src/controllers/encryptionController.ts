import type { PayloadRequest } from 'payload';
import type { PayloadFileRequest } from '@/custom-types';
import { EncryptionOperation } from '@/payload-types';
import { bytesToMB } from '@/shared/data_processing/converter';
import { handleError } from '@/shared/http/response';
import { buildFileTypeStats } from '@/shared/data_processing/converter';

export const createEncryptionResult = async (
  req: PayloadRequest,
  dataFiles: Array<PayloadFileRequest> | PayloadFileRequest,
  elapsedMs: number,
  operation: 'encrypt' | 'decrypt'
): Promise<EncryptionOperation | Response> => {
  try {
    const list = Array.isArray(dataFiles) ? dataFiles : [dataFiles];

    const totalBytes = list.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
    const { uniqueTypes, counts } = buildFileTypeStats(list);

    const now = new Date();
    const opTitle = `${operation.toUpperCase()} • ${list.length} file(s) • ${now.toLocaleString('es-PE')}  • ${String(req.user?.id ?? '')}`;

    const doc = await req.payload.create({
      collection: 'encryption_operations',
      data: {
        tenant_id: String(req.user?.id ?? ''),
        operation_type: operation,
        operation_title: opTitle, // <- lo agregaste en el schema (readOnly en admin está ok)
        file_count: list.length,
        total_size_mb: bytesToMB(totalBytes),

        // ✅ SIN repetidos y en el formato que espera tu schema (array de objetos con { value })
        file_types: uniqueTypes.map((value) => ({ value })),

        // ✅ CONTEO por tipo (tu campo es JSON)
        file_types_count: counts,

        processing_time_ms: Math.max(0, Math.round(elapsedMs)),
        encryption_method: 'AES-256-GCM',
        success: true,
        operation_timestamp: now.toISOString()
      }
    });

    return doc;
  } catch (error: unknown) {
    return handleError(error, 'Error creando registro de operación de encriptación', 'encrypt');
  }
};
