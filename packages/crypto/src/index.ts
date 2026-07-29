import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const PAYLOAD_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HKDF_SALT = Buffer.from("fixnote-envelope-v1", "utf8");

export class CryptoConfigurationError extends Error {}
export class CryptoIntegrityError extends Error {}

export interface EncryptedPayload {
  version: number;
  bytes: Buffer;
}

export interface Keyring {
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

interface DerivedKeys {
  encryption: Buffer;
  integrity: Buffer;
}

export function createKeyringFromEnv(env: NodeJS.ProcessEnv = process.env): Keyring {
  const activeVersion = Number(env.FIXNOTE_KEK_VERSION ?? "1");
  if (!Number.isInteger(activeVersion) || activeVersion < 1) {
    throw new CryptoConfigurationError("FIXNOTE_KEK_VERSION must be a positive integer");
  }

  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = /^FIXNOTE_KEK_V(\d+)$/.exec(name);
    if (!match || !value) continue;
    const version = Number(match[1]);
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== KEY_BYTES) {
      throw new CryptoConfigurationError(`${name} must decode to 32 bytes`);
    }
    keys.set(version, decoded);
  }

  if (!keys.has(activeVersion)) {
    if (env.NODE_ENV === "production") {
      throw new CryptoConfigurationError(`Missing FIXNOTE_KEK_V${activeVersion}`);
    }
    keys.set(activeVersion, createHmac("sha256", "fixnote-development-only").update("local-kek").digest());
  }

  return { activeVersion, keys };
}

export class EnvelopeCrypto {
  constructor(private readonly keyring: Keyring) {}

  generateDataKey(): Buffer {
    return randomBytes(KEY_BYTES);
  }

  encryptText(plaintext: string, dataKey: Buffer, aad: string): Buffer {
    return this.encrypt(Buffer.from(plaintext, "utf8"), dataKey, aad);
  }

  decryptText(payload: Uint8Array, dataKey: Buffer, aad: string): string {
    return this.decrypt(payload, dataKey, aad).toString("utf8");
  }

  encrypt(plaintext: Uint8Array, dataKey: Buffer, aad: string): Buffer {
    const { encryption } = deriveKeys(dataKey);
    return encryptAesGcm(plaintext, encryption, aad, PAYLOAD_VERSION);
  }

  decrypt(payload: Uint8Array, dataKey: Buffer, aad: string): Buffer {
    const { encryption } = deriveKeys(dataKey);
    return decryptAesGcm(payload, encryption, aad);
  }

  wrapDataKey(dataKey: Buffer, aad: string, version = this.keyring.activeVersion): Buffer {
    const key = this.keyring.keys.get(version);
    if (!key) throw new CryptoConfigurationError(`Unknown KEK version ${version}`);
    return encryptAesGcm(dataKey, key, aad, version);
  }

  unwrapDataKey(payload: Uint8Array, aad: string): Buffer {
    const version = readVersion(payload);
    const key = this.keyring.keys.get(version);
    if (!key) throw new CryptoConfigurationError(`Missing KEK version ${version}`);
    const dataKey = decryptAesGcm(payload, key, aad);
    if (dataKey.length !== KEY_BYTES) throw new CryptoIntegrityError("Invalid unwrapped data key length");
    return dataKey;
  }

  rewrapDataKey(payload: Uint8Array, aad: string): Buffer {
    return this.wrapDataKey(this.unwrapDataKey(payload, aad), aad);
  }

  hashText(plaintext: string, dataKey: Buffer): string {
    const { integrity } = deriveKeys(dataKey);
    return createHmac("sha256", integrity).update(plaintext, "utf8").digest("hex");
  }

  verifyTextHash(plaintext: string, expectedHex: string, dataKey: Buffer): boolean {
    const actual = Buffer.from(this.hashText(plaintext, dataKey), "hex");
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}

export function resourceAad(resourceId: string, kind: string, field: string, schemaVersion = 1): string {
  return `fixnote|resource|${resourceId}|${kind}|${field}|schema:${schemaVersion}`;
}

export function folderAad(folderId: string, field: string, schemaVersion = 1): string {
  return `fixnote|folder|${folderId}|${field}|schema:${schemaVersion}`;
}

export function profileAad(profileId: string, field: string, schemaVersion = 1): string {
  return `fixnote|profile|${profileId}|${field}|schema:${schemaVersion}`;
}

export function aiThreadAad(threadId: string, field: string, schemaVersion = 1): string {
  return `fixnote|ai-thread|${threadId}|${field}|schema:${schemaVersion}`;
}

export function searchChunkAad(
  resourceId: string,
  resourceKind: string,
  chunkKind: string,
  nodeId: string | null,
  schemaVersion = 1,
): string {
  const field = nodeId
    ? `search:${chunkKind}:${nodeId}`
    : `search:${chunkKind}`;
  return resourceAad(
    resourceId,
    resourceKind,
    field,
    schemaVersion,
  );
}

export function documentAad(documentName: string, schemaVersion = 1): string {
  return `fixnote|ydoc|${documentName}|schema:${schemaVersion}`;
}

function deriveKeys(dataKey: Buffer): DerivedKeys {
  if (dataKey.length !== KEY_BYTES) throw new CryptoConfigurationError("Data key must contain 32 bytes");
  const material = Buffer.from(hkdfSync("sha256", dataKey, HKDF_SALT, Buffer.from("content", "utf8"), 64));
  return {
    encryption: material.subarray(0, KEY_BYTES),
    integrity: material.subarray(KEY_BYTES),
  };
}

function encryptAesGcm(
  plaintext: Uint8Array,
  key: Buffer,
  aad: string,
  version: number,
): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.allocUnsafe(2);
  header.writeUInt16BE(version, 0);
  return Buffer.concat([header, nonce, tag, ciphertext]);
}

function decryptAesGcm(payload: Uint8Array, key: Buffer, aad: string): Buffer {
  const bytes = Buffer.from(payload);
  if (bytes.length < 2 + NONCE_BYTES + TAG_BYTES) throw new CryptoIntegrityError("Encrypted payload is too short");
  const nonce = bytes.subarray(2, 2 + NONCE_BYTES);
  const tag = bytes.subarray(2 + NONCE_BYTES, 2 + NONCE_BYTES + TAG_BYTES);
  const ciphertext = bytes.subarray(2 + NONCE_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new CryptoIntegrityError("Encrypted payload authentication failed");
  }
}

function readVersion(payload: Uint8Array): number {
  const bytes = Buffer.from(payload);
  if (bytes.length < 2) throw new CryptoIntegrityError("Encrypted payload is too short");
  return bytes.readUInt16BE(0);
}
