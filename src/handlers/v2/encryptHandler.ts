// src/handlers/encryptSingleStreamHandler.ts
import type { PayloadRequest } from 'payload';
import { Readable } from 'node:stream';
import { getSingleStreamAndValidateFromBusboy } from '@/utils/http/requestProcesses';
import { encryptStreamGCM } from '@/utils/data_processing/encryption';
import { isValidUser } from '@/utils/http/auth';
import { handleError, response } from '@/utils/http/response'; // Asumiendo que tienes estas funciones

export async function encryptSingleStreamHandlerV2(req: PayloadRequest): Promise<Response> {
  try {
    const errors: Array<string> = [];

    // 1️⃣ Auth
    const validUser = await isValidUser(req);
    if (validUser instanceof Response) return validUser;

    // 2️⃣ Obtener el stream, password y hacer validaciones en el proceso
    const validationRules = [
      'file-type-validation', // Validar tipo de archivo
      'filename-validation', // Validar nombre de archivo
      'password-strength' // Validar fortaleza de contraseña
    ];
    console.log('Validando:', validationRules);
    const { filename, stream, password } = await getSingleStreamAndValidateFromBusboy(req, errors, validationRules);
    console.log('Validación completa:', { filename, stream, password });

    // 3️⃣ Verificar si hubo errores durante el parsing/validación
    if (errors.length > 0) return response(400, { error: errors }, 'Bad Request');

    // 4️⃣ Proceder con la encriptación si no hay errores
    const encName = `${filename}.enc`;
    //console.log('Nombre del archivo encriptado:', encName);
    const { output } = encryptStreamGCM(stream, password);
    //console.log('Stream de salida encriptado listo.', output);
    // Conversión del stream para la respuesta web
    const nodeOut = output as unknown as NodeJS.ReadableStream;
    const webOut = typeof (Readable as any).toWeb === 'function' ? (Readable as any).toWeb(nodeOut) : (nodeOut as any);

    return new Response(webOut, {
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encName}"; filename*=UTF-8''${encodeURIComponent(encName)}`,
        'Cache-Control': 'private, no-store, no-transform',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'none',
        'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length'
      })
    });
  } catch (err: any) {
    return handleError(err, 'Error durante la encriptación del archivo', 'encrypt_single_stream');
  }
}
