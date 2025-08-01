import crypto from 'crypto'

export async function generateApiKey() {
  return crypto.randomBytes(64).toString('hex')
}

export async function generateApiSecret() {
  return crypto.randomBytes(128).toString('hex')
}

export async function generateRandomPassword() {
  return crypto.randomBytes(8).swap32().toString('hex')
}
