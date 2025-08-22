// src/collections/ResourceUsageDaily.ts
import { CollectionConfig } from 'payload';
import { onlyAdmins } from '@/shared/http/auth';

export const ResourceUsageDaily: CollectionConfig = {
  slug: 'resource_usage_daily',
  timestamps: true,
  access: {
    read: onlyAdmins,
    create: onlyAdmins,
    update: onlyAdmins,
    delete: onlyAdmins
  },
  fields: [
    {
      name: 'tenant_id',
      type: 'relationship',
      relationTo: 'tenants',
      required: true
    },
    {
      name: 'usage_date',
      type: 'date',
      label: 'Usage Date',
      required: true,
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        position: 'sidebar'
      }
    },
    {
      name: 'total_operations',
      type: 'number',
      label: 'Total Operations',
      required: true,
      min: 0
    },
    {
      name: 'encrypt_operations',
      type: 'number',
      label: 'Encrypt Operations',
      required: true,
      min: 0
    },
    {
      name: 'decrypt_operations',
      type: 'number',
      label: 'Decrypt Operations',
      required: true,
      min: 0
    },
    {
      name: 'total_mb_processed',
      type: 'number',
      label: 'Total Processed (MB)',
      required: true,
      min: 0
    },
    {
      name: 'total_files_processed',
      type: 'number',
      label: 'Total Files Processed',
      required: true,
      min: 0
    },
    {
      name: 'failed_operations',
      type: 'number',
      label: 'Failed Operations',
      required: true,
      min: 0
    },
    {
      name: 'avg_processing_time',
      type: 'number',
      label: 'Average Processing Time (ms)',
      required: true,
      min: 0
    },
    {
      name: 'file_type_breakdown',
      type: 'json',
      label: 'File Type Breakdown',
      required: false
    }
  ],
  indexes: [
    // 1) Único por tenant y día  → garantiza 1 documento por día/tenant (idempotencia del job)
    { unique: true, fields: ['tenant_id', 'usage_date'] },

    // 2) Ventanas y listados por fecha con paginado estable
    { fields: ['usage_date', 'createdAt'] }
  ]
};
