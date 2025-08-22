// src/collections/ErrorLogs.ts
import { CollectionConfig } from 'payload';
import { onlyAdmins } from '@/shared/http/auth';

export const ErrorLogs: CollectionConfig = {
  slug: 'error_logs',
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
      name: 'operation_id',
      type: 'relationship',
      relationTo: 'encryption_operations',
      required: false
    },
    {
      name: 'error_code',
      type: 'text',
      label: 'Error Code',
      required: false
    },
    {
      name: 'error_type',
      type: 'text',
      label: 'Error Type',
      required: false
    },
    {
      name: 'error_message',
      type: 'textarea',
      label: 'Error Message',
      required: true
    },
    {
      name: 'stack_trace',
      type: 'textarea',
      label: 'Stack Trace',
      required: false
    },
    {
      name: 'context_data',
      type: 'json',
      label: 'Context Data',
      required: false
    },
    {
      name: 'level',
      type: 'select',
      label: 'Log Level',
      options: [
        { label: 'INFO', value: 'INFO' },
        { label: 'WARN', value: 'WARN' },
        { label: 'ERROR', value: 'ERROR' },
        { label: 'FATAL', value: 'FATAL' }
      ],
      required: true,
      defaultValue: 'ERROR'
    },
    {
      name: 'error_timestamp',
      type: 'date',
      label: 'Error Timestamp',
      required: true,
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        position: 'sidebar'
      }
    },
    {
      name: 'error_date',
      type: 'date',
      label: 'Error Date',
      required: true,
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        position: 'sidebar'
      }
    }
  ]
};
