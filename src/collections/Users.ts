import type { CollectionConfig } from 'payload';
import { onlyAdmins } from '@/shared/http/auth';

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email'
  },
  auth: true,
    access: {
      read: onlyAdmins,
      create: onlyAdmins,
      update: onlyAdmins,
      delete: onlyAdmins
    },
  fields: [
    // Email added by default
    // Add more fields as needed
    {
      name: 'role',
      type: 'select',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'User', value: 'user' }
      ],
      defaultValue: 'user',
      label: 'Rol'
    }
  ]
};
