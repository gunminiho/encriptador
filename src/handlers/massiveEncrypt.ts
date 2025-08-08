// src/collections/EncryptionOperations.ts
import { PayloadRequest } from 'payload';
import { v4 as uuidv4 } from 'uuid';
import { encryptFileGCM } from '@/services/encryption';
import { response } from '@/utils/http/response';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { performance } from 'perf_hooks';
import { isValidUser } from '@/utils/http/auth';
import { getRequestData, MassiveEncryptionRequest } from '@/utils/http/requestProcesses';
import { csvParser } from '@/utils/data_processing/csvParser';
import { validateRequest } from '@/utils/validator/requestValidator';

export const massiveEncryption = async (req: PayloadRequest): Promise<Response> => {
  const errors: Array<string> = [];
  try {
    // 1️⃣ Auth
    const validUser = await isValidUser(req);
    if (validUser instanceof Response) return validUser;

    // 2️⃣ Multipart → files + CSV
    const responseRequest = await getRequestData(req);
    if (responseRequest instanceof String) errors.push(responseRequest as string);
    const { csvFile, dataFiles } = responseRequest as MassiveEncryptionRequest;

    // 3️⃣ Parsear CSV en un Map<fileName,password>
    const pwMap = csvParser(csvFile); // devuelve Map<string, string>;

    // 4️⃣ Validaciones: que cada archivo tenga password, etc
    const validateResponse = validateRequest({ csvFile, dataFiles }, pwMap as Map<string, string>);
    if (validateResponse instanceof Response) return validateResponse;

    // 5️⃣ Cifrar todos y enviar zip
    const zipStream = new PassThrough(); // stream de salida
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(zipStream); // conecta zip al stream

    const totalFiles = dataFiles.length;
    const start = performance.now(); // ⏱️ inicio del cronómetro
    console.log(`🔐 Archivos a encriptar: ${totalFiles}`);
    for (let i = 0; i < totalFiles; i++) {
      const file = dataFiles[i];
      const pwd = (pwMap as Map<string, string>).get(file.name)!;
      const { fileName, blob } = await encryptFileGCM((file as any).data, pwd, file.name);
      const percent = ((i + 1) / totalFiles) * 100;
      const percentFormatted = percent.toFixed(2).padStart(6, ' ');
      process.stdout.write(`\r🛠️ Encriptando ${i + 1} de ${totalFiles} | Completado: ${percentFormatted}%`);
      if (!Buffer.isBuffer(blob)) {
        throw new Error(`encryptFileGCM no devolvió un Buffer válido para ${file.name}`);
      }
      archive.append(blob, { name: fileName });
    }
    const end = performance.now(); // ⏱️ fin del cronómetro
    const elapsedMs = end - start;
    console.log(`\n✅ Encriptación completada en ${(elapsedMs / 1000).toFixed(2)} segundos.`);
    // Finaliza el zip
    archive.finalize();

    // 6️⃣ Registrar operación masiva
    await req.payload.create({
      collection: 'encryption_operations',
      data: {
        tenant_id: req.user.id,
        operation_type: 'encrypt',
        file_count: dataFiles.length,
        total_size_mb: dataFiles.reduce((sum, f) => sum + (f as any).size, 0),
        file_types: dataFiles.map((f) => f.name.split('.').pop()?.toLowerCase()),
        processing_time_ms: elapsedMs,
        encryption_method: 'AES-256-GCM',
        success: true,
        operation_timestamp: new Date().toISOString()
      }
    });
    // 7️⃣ Responder multipart/mixed
    return new Response(zipStream as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${'encriptado_' + uuidv4()}.zip"`,
        'Transfer-Encoding': 'chunked'
      }
    });
  } catch (err: any) {
    console.error(err);
    return response(500, { error: err.message }, 'Error interno');
  }
};
