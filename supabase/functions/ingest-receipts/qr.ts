import jsQR from 'npm:jsqr@1.4.0';
import { decode as decodeJpeg } from 'npm:jpeg-js@0.4.4';
import { PNG } from 'npm:pngjs@7.0.0';
import { parseUaeVatQr } from './core.ts';

export type QrEvidence = { raw: string; uae_vat: ReturnType<typeof parseUaeVatQr> | null };

export async function decodeReceiptQr(bytes: Uint8Array | null, mime: string): Promise<QrEvidence | null> {
  if (!bytes || !['image/jpeg', 'image/png'].includes(mime)) return null;
  try {
    const image = mime === 'image/jpeg'
      ? decodeJpeg(bytes, { useTArray: true })
      : PNG.sync.read(bytes);
    const code = jsQR(new Uint8ClampedArray(image.data), image.width, image.height, { inversionAttempts: 'attemptBoth' });
    if (!code?.data?.trim()) return null;
    return { raw: code.data.trim().slice(0, 4096), uae_vat: parseUaeVatQr(code.data.trim()) };
  } catch {
    return null;
  }
}
