import type { CollectionConfig } from 'payload'
//import { generateApiKey, generateApiSecret } from '@/utils/crypto'

export const Tenants: CollectionConfig = {
  slug: 'tenants',
  auth: {
    useAPIKey: true,
    disableLocalStrategy: true, // desactiva el login con email/password
  },
  timestamps: true,
  admin: {
    useAsTitle: 'name',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Tenant Name',
      required: true,
    },
    {
      name: 'email',
      type: 'email',
      label: 'Tenant Email',
      required: true,
      unique: true,
    },
    {
      name: 'state',
      type: 'checkbox',
      label: 'Status',
      defaultValue: true,
      required: true,
      admin: {
        description: 'Tenant status',
        readOnly: true,
      },
    },
  ],
}
