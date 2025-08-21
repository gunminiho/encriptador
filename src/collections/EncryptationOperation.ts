// src/collections/EncryptionOperations.ts
import { CollectionConfig } from 'payload';
import { decryptSingleStreamHandlerV2 } from '@/handlers/v2/decryptHandler';
import { encryptSingleStreamHandlerV2 } from '@/handlers/v2/encryptHandler';
import { massiveEncryptionHandlerV2 } from '@/handlers/v2/massiveEncryptionHandler';

export const EncryptionOperations: CollectionConfig = {
  slug: 'encryption_operations',
  timestamps: true,
  admin: {
    useAsTitle: 'operation_title' // ← ahora es texto
  },
  fields: [
    {
      name: 'operation_title', // 1) Título derivado, solo lectura
      type: 'text',
      admin: { readOnly: true }
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
      type: 'array',
      fields: [{ name: 'value', type: 'text' }],
      admin: { description: 'Lista única de extensiones' }
    },
    {
      name: 'file_types_count',
      type: 'json', // <- sencillo para guardar { pdf: 10, xlsx: 2, ... }
      admin: { description: 'Conteo por tipo de archivo' }
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
      options: [{ value: 'AES-256-GCM', label: 'AES-256-GCM' }],
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
        const tsRaw = data?.operation_timestamp ?? new Date().toLocaleString('es-PE');
        const d = tsRaw instanceof Date ? tsRaw : new Date(tsRaw);
        const when = Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-PE').replace('T', ' ').substring(0, 19);
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
      path: '/v2/massive-encrypt', // =>  /api/encryption_operations/v2/massive-encrypt
      method: 'post',
      handler: massiveEncryptionHandlerV2
    },
    {
      path: '/v2/decrypt', // =>  /api/encryption_operations/v2/massive-encrypt
      method: 'post',
      handler: decryptSingleStreamHandlerV2
    },
    {
      path: '/v2/encrypt', // =>  /api/encryption_operations/v2/massive-encrypt
      method: 'post',
      handler: encryptSingleStreamHandlerV2
    }
  ]
};