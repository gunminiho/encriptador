import type { CollectionConfig } from 'payload';
import { onlyAdmins } from '@/shared/http/auth';

export const Tenants: CollectionConfig = {
  slug: 'tenants',
  auth: {
    useAPIKey: true,
    disableLocalStrategy: true
  },
  timestamps: true,
  access: {
    read: onlyAdmins,
    create: onlyAdmins,
    update: onlyAdmins,
    delete: onlyAdmins
  },
  admin: {
    useAsTitle: 'name'
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Tenant Name',
      required: true
    },
    {
      name: 'email',
      type: 'email',
      label: 'Tenant Email',
      required: true,
      unique: true
    },
    {
      name: 'state',
      type: 'checkbox',
      label: 'Status',
      defaultValue: true,
      required: true,
      admin: {
        description: 'Tenant status',
        readOnly: true
      }
    }
  ]
};
