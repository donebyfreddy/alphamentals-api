import { createCipheriv, createDecipheriv, randomBytes, type CipherGCM, type DecipherGCM } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

export interface EncryptedCredential {
  ciphertext: string;
  iv: string;
  tag: string;
  algorithm: string;
}

function getEncryptionKey(): Buffer {
  const raw = process.env.ACCOUNT_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw?.trim()) {
    throw new Error('ENCRYPTION_KEY_MISSING: ACCOUNT_CREDENTIALS_ENCRYPTION_KEY is not set');
  }
  const buf = Buffer.from(raw.trim(), 'utf8');
  if (buf.length < 32) {
    throw new Error('ENCRYPTION_KEY_MISSING: ACCOUNT_CREDENTIALS_ENCRYPTION_KEY must be at least 32 bytes');
  }
  return buf.subarray(0, 32);
}

export function encryptPassword(plaintext: string): EncryptedCredential {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv) as CipherGCM;
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    algorithm: ALGORITHM,
  };
}

export function decryptPassword(credential: EncryptedCredential): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(credential.iv, 'base64');
  const tag = Buffer.from(credential.tag, 'base64');
  const ciphertext = Buffer.from(credential.ciphertext, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv) as DecipherGCM;
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function isEncryptionConfigured(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}
