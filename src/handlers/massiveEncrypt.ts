// src/collections/EncryptionOperations.ts
import { PayloadRequest } from 'payload';
import { v4 as uuidv4 } from 'uuid';
import { addDataAndFileToRequest } from 'payload';
import { encryptFileGCM } from '@/services/encryption';
import { response } from '@/utils/response';
import { Readable } from 'stream';

export const massiveEncryption = async (req: PayloadRequest): Promise<Response> => {
  try {
    // 1️⃣ Auth
    const auth = req.headers.get('Authorization') || '';
    if (!auth.includes('API-Key') || !req.user) {
      return response(401, { error: 'No autorizado' }, 'Api Key inválida');
    }

    // 2️⃣ Multipart → files + CSV
    await addDataAndFileToRequest(req);
    const allFiles = Array.isArray(req.file) ? req.file : [req.file].filter(Boolean);
    const csvFile = allFiles.find((f) => f.name === 'passwords.csv');
    const dataFiles = allFiles.filter((f) => f.name !== 'passwords.csv');

    if (!csvFile) {
      return response(400, { error: 'Falta passwords.csv' }, 'Bad Request');
    }
    if (dataFiles.length < 2) {
      return response(400, { error: 'Se necesitan ≥2 archivos para encriptación masiva' }, 'Bad Request');
    }

    // 3️⃣ Parsear CSV en un Map<fileName,password>
    const csvText = Buffer.from((csvFile as any).data).toString('utf-8');
    const pwMap = new Map<string, string>();
    for (const line of csvText.split(/\r?\n/).filter((l) => l.trim())) {
      const [file_name, pwd] = line.split(/\s*[;,]\s*/).map((s) => s.trim());
      if (file_name && pwd) pwMap.set(file_name, pwd);
    }

    //console.log('csvText:', csvText );
    pwMap.forEach((pw, key) => console.log(pw, ' || ', key));

    // 4️⃣ Validar que cada archivo tenga password
    const missing = dataFiles.filter((f) => !pwMap.has(f.name));
    if (missing.length) {
      return response(400, { error: `Faltan passwords para: ${missing.map((f) => f.name).join(', ')}` }, 'Bad Request');
    }

    // 5️⃣ Cifrar todos y montar multipart
    const boundary = `ENC-MULTI-${uuidv4()}`;
    const parts: Buffer[] = [];

    for (const file of dataFiles) {
      const pwd = pwMap.get(file.name)!;
      const { fileName, blob } = await encryptFileGCM((file as any).data, pwd, file.name);
      console.log(fileName, ' 🔓 Received buffer length:', blob.byteLength);
      // Cabecera de parte
      parts.push(Buffer.from(`--${boundary}\r\n` + `Content-Disposition: attachment; filename="${fileName}"\r\n` + `Content-Type: application/octet-stream\r\n\r\n`));
      // Cuerpo binario
      parts.push(Buffer.from(blob));
      parts.push(Buffer.from('\r\n'));
    }
    // Cierre de multipart
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    // 6️⃣ Registrar operación masiva
    await req.payload.create({
      collection: 'encryption_operations',
      data: {
        tenant_id: req.user.id,
        operation_type: 'encrypt',
        file_count: dataFiles.length,
        total_size_mb: dataFiles.reduce((sum, f) => sum + (f as any).size, 0),
        file_types: dataFiles.map((f) => f.name.split('.').pop()?.toLowerCase()),
        processing_time_ms: 0, // opcional: medir por separado
        encryption_method: 'AES-256-GCM',
        success: true,
        operation_timestamp: new Date().toISOString()
      }
    });

    const bodyStream = Readable.from(parts);

    // 7️⃣ Responder multipart/mixed
    return new Response(bodyStream as any, {
      status: 200,
      headers: {
        'Content-Type': `multipart/mixed; boundary=${boundary}`,
        'Transfer-Encoding': 'chunked'
      }
    });
  } catch (err: any) {
    console.error(err);
    return response(500, { error: err.message }, 'Error interno');
  }
};
