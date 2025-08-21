// src/AdminLogo.tsx
import type { JSX } from 'react';
import Image from 'next/image';

export default function AdminLogo(): JSX.Element {
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'row', gap: '10px', alignItems: 'center', justifyContent: 'center', color: '#5C5FCF' }}>
        <h2>Panel de Administración</h2>
        <Image
          src="/assets/omn_logo.svg" // en <root>/public/assets/omn_logo.svg
          alt="OMN"
          width={56}
          height={56}
          style={{ display: 'block' }}
        />
      </div>
    </>
  );
}
