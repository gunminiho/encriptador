import Image from 'next/image';
import React from 'react';
import Logo from '@/assets/omn_logo.svg';

import './styles.css';

export default async function HomePage() {
  return (
    <>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#5C5FCF' }}>
        <h1>CRYPTO.OMN.PE</h1>
        <Image src={Logo} alt="Omn Logo" width={350} height={350} />
      </div>
    </>
  );
}
