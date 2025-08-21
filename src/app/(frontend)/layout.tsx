import React from 'react';
import './styles.css';

export const metadata = {
  description: 'CRYPTO OMN.PE',
  title: 'CRYPTO OMN.PE',
  icons: [{ rel: 'icon', url: '/assets/omn_logo.svg' }]
};

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props;
  return (
    <html lang="es">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
