import { createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_DIGITS = 6;
const DEFAULT_STEP_SECONDS = 30;

function normalizeBase32(input: string): string {
  return input.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31] ?? "";
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31] ?? "";
  }

  return output;
}

function base32Decode(input: string): Buffer {
  const normalized = normalizeBase32(input);
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      continue;
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number, digits = DEFAULT_DIGITS): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;

  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, "0");
}

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

export function generateTotpCode(secretBase32: string, timestampMs = Date.now(), stepSeconds = DEFAULT_STEP_SECONDS, digits = DEFAULT_DIGITS): string {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / (stepSeconds * 1000));
  return hotp(secret, counter, digits);
}

export function verifyTotpCode(
  secretBase32: string,
  inputCode: string,
  options?: {
    window?: number;
    timestampMs?: number;
    stepSeconds?: number;
    digits?: number;
  },
): boolean {
  const normalizedCode = inputCode.trim();
  const digits = options?.digits ?? DEFAULT_DIGITS;
  if (!new RegExp(`^\\d{${digits}}$`).test(normalizedCode)) {
    return false;
  }

  const secret = base32Decode(secretBase32);
  const window = options?.window ?? 1;
  const stepSeconds = options?.stepSeconds ?? DEFAULT_STEP_SECONDS;
  const timestampMs = options?.timestampMs ?? Date.now();
  const counter = Math.floor(timestampMs / (stepSeconds * 1000));

  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(secret, counter + offset, digits);
    if (expected === normalizedCode) {
      return true;
    }
  }

  return false;
}

export function buildTotpUri(input: { issuer: string; accountName: string; secret: string }): string {
  const issuer = input.issuer.trim();
  const accountName = input.accountName.trim();
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: "SHA1",
    digits: `${DEFAULT_DIGITS}`,
    period: `${DEFAULT_STEP_SECONDS}`,
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}
