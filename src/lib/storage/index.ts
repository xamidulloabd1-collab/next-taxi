import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { env } from "@/lib/env";

/** Private object storage for driver documents. Nothing here is ever served from /public. */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[a-z0-9][a-z0-9/_-]{8,200}\.(jpg|png|webp|pdf)$/;
export function assertSafeKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..")) throw new Error("Unsafe storage key");
}

const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };

/** Local disk storage (development / single-server deployments with a persistent volume). */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Path traversal blocked");
    return full;
  }

  async put(key: string, body: Uint8Array) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    await writeFile(full, body, { mode: 0o600 });
  }

  async get(key: string) {
    try {
      const body = await readFile(this.resolve(key));
      return { body: new Uint8Array(body), contentType: MIME_BY_EXT[key.split(".").pop()!] ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await unlink(this.resolve(key)).catch(() => undefined);
  }
}

/**
 * S3-compatible private bucket (Cloudflare R2, Backblaze B2, MinIO, AWS S3).
 * Requires a bucket with public access disabled. Not exercised against a real bucket here.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  private client: AwsClient;
  constructor(
    private readonly endpoint: string,
    private readonly bucket: string,
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
  ) {
    this.client = new AwsClient({ accessKeyId, secretAccessKey, region, service: "s3" });
  }

  private url(key: string) {
    assertSafeKey(key);
    return `${this.endpoint.replace(/\/$/, "")}/${this.bucket}/${key}`;
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    const res = await this.client.fetch(this.url(key), { method: "PUT", body: Buffer.from(body), headers: { "content-type": contentType } });
    if (!res.ok) throw new Error(`S3 PUT failed: ${res.status}`);
  }

  async get(key: string) {
    const res = await this.client.fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 GET failed: ${res.status}`);
    return { body: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }

  async delete(key: string) {
    await this.client.fetch(this.url(key), { method: "DELETE" });
  }
}

let provider: StorageProvider | null = null;
export function getStorage(): StorageProvider {
  if (provider) return provider;
  const e = env();
  provider =
    e.STORAGE_PROVIDER === "s3"
      ? new S3StorageProvider(e.S3_ENDPOINT!, e.S3_BUCKET!, e.S3_ACCESS_KEY_ID!, e.S3_SECRET_ACCESS_KEY!, e.S3_REGION)
      : new LocalStorageProvider(path.resolve(process.cwd(), e.STORAGE_LOCAL_DIR));
  return provider;
}

/** Detects file type from magic bytes; the client-declared MIME type is never trusted. */
export function sniffFileType(bytes: Uint8Array): { ext: "jpg" | "png" | "webp" | "pdf"; mime: string } | null {
  const b = bytes;
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP")
    return { ext: "webp", mime: "image/webp" };
  if (b.length > 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-") return { ext: "pdf", mime: "application/pdf" };
  return null;
}
