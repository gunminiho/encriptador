import type { CollectionConfig } from 'payload';
import { onlyAdmins } from '@/shared/http/auth';

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: onlyAdmins,
    create: onlyAdmins,
    update: onlyAdmins,
    delete: onlyAdmins
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true
    }
  ],
  upload: true
};
