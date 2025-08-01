// src/collections/EncryptionOperations.ts
import { CollectionConfig, PayloadHandler, PayloadRequest } from 'payload'
import { v4 as uuidv4 } from 'uuid'
import { generateRandomPassword } from '@/utils/crypto'
import { Endpoint } from 'payload'

const metadata = { salt: 5, key2: '0xF2B40' }

const encryptController: PayloadHandler = async (req: PayloadRequest) => {}

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
      method: 'post',
      path: '/v1/encrypt',
      handler: await encryptController,
    },
  ],
}
