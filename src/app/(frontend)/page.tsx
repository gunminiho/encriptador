import Image from 'next/image';
import React from 'react';

import './styles.css';

export default async function HomePage() {
  return (
    <>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#5C5FCF' }}>
        <h1>CRYPTO.OMN.PE</h1>
        <Image src="/assets/omn_logo.svg" alt="Omn Logo" width={350} height={350} />
      </div>
    </>
  );
}
