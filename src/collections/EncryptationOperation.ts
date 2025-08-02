// src/collections/EncryptionOperations.ts
import { CollectionConfig, PayloadRequest } from 'payload';
import { v4 as uuidv4 } from 'uuid';
import { generateRandomPassword } from '@/utils/crypto';
import { response } from '@/utils/response';
import { addDataAndFileToRequest } from 'payload';
//import { deriveKeyAndEncryptFile } from '@/services/encryption';

const metadata = { salt: 5, key2: '0xF2B40' };

export const EncryptionOperations: CollectionConfig = {
  slug: 'encryption_operations',
  timestamps: true,
  admin: {
    useAsTitle: 'tenant_id',
  },
  fields: [
    {
      name: 'tenant_id',
      type: 'relationship',
      relationTo: 'tenants',
      required: true,
    },
    {
      name: 'request_id',
      type: 'text',
      label: 'Request ID',
      unique: true,
      required: true,
      defaultValue: () => uuidv4(),
      admin: {
        position: 'sidebar',
        readOnly: true,
        hidden: true,
      },
    },
    {
      name: 'operation_type',
      type: 'select',
      label: 'Operation Type',
      options: [
        { label: 'Encrypt', value: 'encrypt' },
        { label: 'Decrypt', value: 'decrypt' },
      ],
      required: true,
    },
    {
      name: 'file_count',
      type: 'number',
      label: 'File Count',
      required: true,
      defaultValue: 0,
      min: 0,
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'total_size_bytes',
      type: 'number',
      label: 'Total Size (bytes)',
      required: true,
      defaultValue: 0,
      min: 0,
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'file_types',
      type: 'json',
      label: 'File Types',
      required: false,
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'processing_time_ms',
      type: 'number',
      label: 'Processing Time (ms)',
      required: true,
      min: 0,
      defaultValue: 0,
    },
    {
      name: 'is_password_provided',
      type: 'checkbox',
      label: 'Client Provided Password',
      defaultValue: true,
      required: true,
    },
    {
      name: 'password',
      type: 'text',
      label: 'Password',
      required: true,
      defaultValue: () => generateRandomPassword(),
      admin: {
        description: 'Si el cliente proporciona la contraseña, esta se autogenera',
        placeholder: 'contraseña',
      },
    },
    {
      name: 'encryption_method',
      type: 'select',
      label: 'Encryption Method',
      options: [
        { value: 'AES', label: 'AES' },
        { value: 'RSA', label: 'RSA' },
      ],
      required: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'success',
      type: 'checkbox',
      label: 'Success',
      defaultValue: true,
      required: true,
    },
    {
      name: 'metadata',
      type: 'json',
      label: 'Metadata',
      required: false,
      defaultValue: metadata,
      admin: {
        description: 'Metadata para el evento',
      },
    },
    {
      name: 'operation_timestamp',
      type: 'date',
      label: 'Operation Timestamp',
      required: true,
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        position: 'sidebar',
      },
    },
  ],
  endpoints: [
    {
      path: '/encrypt', // la ruta completa será /api/encryption_operations/encrypt
      method: 'post',
      handler: async (req: PayloadRequest): Promise<Response> => {
        try {
          const authHeader = req.headers.get('Authorization');
          const isApiKey = typeof authHeader === 'string' && authHeader.includes('API-Key');
          if (!isApiKey || !req.user)
            return response(401, { error: 'Acceso no autorizado' }, 'Api Key invalida');
          const tenant = req.user; // este es el ID del documento en 'tenants'
          let cloned: Request | null = null;
          let password: string | FormDataEntryValue | null = null;
          let passwords: any = null;
          let files: any = null;
          const errors: Array<string> = [];
          if (typeof req.clone === 'function') {
            cloned = req.clone();
            await addDataAndFileToRequest(req);
            password = (await cloned.formData()).get('password');
            if (Array.isArray(req.file) && req.file.length > 3)
              files = req.file.filter((file) => file.name !== 'passwords.csv');
            if (Array.isArray(req.file))
              passwords = req.file.filter((file) => file.name === 'passwords.csv');
            // console.log('---------');
            // console.log('password:', password);
            // console.log('files:', files.length);
            // console.log('passwords:', passwords.length);
            // console.log('---------');
          }

          // Validacion de datos del endopoint
          if (Array.isArray(files) && files.length < 1)
            errors.push('No se detectaron archivos para encriptar');
          if (password && Array.isArray(files) && files.length < 1)
            errors.push('No se detecto archivo para encriptar con esta contraseña');
          if (!password && Array.isArray(files) && files.length === 1)
            errors.push('No se detecto password para encriptar un solo archivo');
          if (passwords && Array.isArray(files) && files.length === 1)
            errors.push('Solo se detecto el archivo de configuración csv para encriptación masiva');
          if (passwords && Array.isArray(files) && files.length === 2)
            errors.push(
              'Se detecto un solo archivo para encriptar y un archivo de configuración csv para encriptación masiva',
            );
          if (!passwords && Array.isArray(files) && files.length > 2)
            errors.push('No se detecto archivo de passwords para encriptar varios archivos');
          if(password && passwords)
            errors.push('Se detecto password individual y archivo de configuración csv para encriptación masiva, elija cual usar');
          if (errors.length > 0)
            return response(400, errors, 'Error en los parámetros de la solicitud');

          return response(200, { tenant: tenant }, 'tenant encontrado');
        } catch (error: any) {
          console.error(error);
          return response(
            500,
            { error: `'Error interno del servidor: ${error.message}` },
            'Error interno',
          );
        }
      },
    },
  ],
};
