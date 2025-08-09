// src/collections/EncryptionOperations.ts
import { CollectionConfig } from 'payload';
import { encryptHandler } from '@/handlers/encryptHandler';
import { decryptHandler } from '@/handlers/decryptHandler';
import { massiveEncryptionHandler } from '@/handlers/massiveEncrypt';

export const EncryptionOperations: CollectionConfig = {
  slug: 'encryption_operations',
  timestamps: true,
  admin: {
    useAsTitle: 'operation_title', // ← ahora es texto
  },  
  fields: [
     // 1) Título derivado, solo lectura
    {
      name: 'operation_title',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'tenant_id',
      type: 'relationship',
      relationTo: 'tenants',
      required: true
    },
    {
      name: 'operation_type',
      type: 'select',
      label: 'Operation Type',
      options: [
        { label: 'Encrypt', value: 'encrypt' },
        { label: 'Decrypt', value: 'decrypt' }
      ],
      required: true
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
        readOnly: true
      }
    },
    {
      name: 'total_size_mb',
      type: 'number',
      label: 'Total Size (megabytes)',
      required: true,
      defaultValue: 0,
      min: 0,
      admin: {
        position: 'sidebar',
        readOnly: true
      }
    },
    {
      name: 'file_types',
      type: 'json',
      label: 'File Types',
      required: false,
      admin: {
        position: 'sidebar',
        readOnly: true
      }
    },
    {
      name: 'processing_time_ms',
      type: 'number',
      label: 'Processing Time (ms)',
      required: true,
      min: 0,
      defaultValue: 0
    },
    {
      name: 'encryption_method',
      type: 'select',
      label: 'Encryption Method',
      options: [
        { value: 'AES-256-GCM', label: 'AES-256-GCM' }
        // { value: 'RSA-OAEP',  label: 'RSA-OAEP' },  // descomenta cuando soportes RSA
      ],
      required: true,
      defaultValue: 'AES-256-GCM',
      admin: { position: 'sidebar' }
    },
    {
      name: 'success',
      type: 'checkbox',
      label: 'Success',
      defaultValue: true,
      required: true
    },
    {
      name: 'operation_timestamp',
      type: 'date',
      label: 'Operation Timestamp',
      required: true,
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        position: 'sidebar'
      }
    }
  ],
  hooks: {
    beforeValidate: [
      ({ data }) => {
        // Defensivo: convierte todo a string seguro
        const toStr = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
        const op = toStr(data?.operation_type ?? 'operation');
        const files = Number.isFinite(data?.file_count) ? (data!.file_count as number) : 0;
        const tsRaw = data?.operation_timestamp ?? new Date().toLocaleString("es-PE");
        const d = tsRaw instanceof Date ? tsRaw : new Date(tsRaw);
        const when = Number.isNaN(d.getTime()) ? '' : d.toLocaleString("es-PE").replace('T', ' ').substring(0, 19);
        const tenant = toStr(
          typeof data?.tenant_id === 'string'
            ? data.tenant_id
            : // si viene como objeto relationship
              ((data?.tenant_id as any)?.id ?? (data?.tenant_id as any)?.value ?? '')
        );

        data!.operation_title = `${op.toUpperCase()} • ${files} file(s) • ${when} • ${tenant}`;
      }
    ]
  },
  endpoints: [
    {
      path: '/v1/encrypt', // =>   /api/encryption_operations/encrypt
      method: 'post',
      handler: encryptHandler
    },
    {
      path: '/v1/decrypt', // =>  /api/encryption_operations/decrypt
      method: 'post',
      handler: decryptHandler
    },
    {
      path: '/v1/massive-encrypt', // =>  /api/encryption_operations/decrypt
      method: 'post',
      handler: massiveEncryptionHandler
    }
  ]
};
