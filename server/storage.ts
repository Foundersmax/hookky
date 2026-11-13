// Permanent storage for generated clips: Cloudflare R2 (S3-compatible). The video makers delete
// their files after hours or days; a finished clip is copied here so it keeps playing, downloading
// and exporting for as long as the bucket keeps it. Keys stay on the server; clips are streamed
// through Rookker, so the bucket stays private and needs no CORS setup.
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { S3Client, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const env = (n: string) => process.env[n]?.trim() || "";
export const storageOn = () => !!(env("R2_BUCKET") && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY") && (env("R2_ACCOUNT_ID") || env("R2_ENDPOINT")));
export const storageBucket = () => env("R2_BUCKET");

let client: S3Client | null = null;
let clientFor = "";
function s3(): S3Client {
  const endpoint = env("R2_ENDPOINT") || `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  const sig = [endpoint, env("R2_ACCESS_KEY_ID"), env("R2_SECRET_ACCESS_KEY")].join("|");
  if (!client || clientFor !== sig) {
    client = new S3Client({
      region: "auto",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
      // R2 doesn't take the SDK's newer default checksums on streamed uploads
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      maxAttempts: 3,
    });
    clientFor = sig;
  }
  return client;
}

/** Where a job's clip lives in the bucket (no user data in the name). */
export const clipKey = (jobId: string) => `aivideo/${createHash("sha256").update(jobId).digest("hex").slice(0, 40)}.mp4`;

const have = new Map<string, number>(); // key → size, for clips known to be stored
/** The stored clip's size, or null when it isn't in the bucket. */
export async function stored(key: string): Promise<number | null> {
  const hit = have.get(key);
  if (hit !== undefined) return hit;
  try {
    const r = await s3().send(new HeadObjectCommand({ Bucket: storageBucket(), Key: key }));
    const size = Number(r.ContentLength ?? 0);
    have.set(key, size);
    if (have.size > 20000) for (const k of [...have.keys()].slice(0, 4000)) have.delete(k);
    return size;
  } catch (e: any) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey") return null;
    throw e;
  }
}

/** Save a clip (streamed; large files go up in parts). */
export async function saveClip(key: string, body: Readable | Buffer, contentType = "video/mp4", length?: number) {
  const up = new Upload({
    client: s3(),
    params: { Bucket: storageBucket(), Key: key, Body: body, ContentType: contentType, CacheControl: "private, max-age=31536000, immutable", ...(length !== undefined && { ContentLength: length }) },
    partSize: 8 * 1024 * 1024,
    queueSize: 2,
  });
  await up.done();
  have.delete(key);
  return stored(key);
}

/** Read a stored clip, or a byte range of it. */
export async function readClip(key: string, range?: string) {
  const r = await s3().send(new GetObjectCommand({ Bucket: storageBucket(), Key: key, ...(range && { Range: range }) }));
  return {
    status: range && r.ContentRange ? 206 : 200,
    type: r.ContentType || "video/mp4",
    length: r.ContentLength,
    range: r.ContentRange,
    body: r.Body as Readable,
  };
}
