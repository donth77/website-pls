// Note: no `import "server-only"` here — this module is shared with the
// standalone BullMQ worker (tsx), which doesn't use the Next.js bundler.
// Keep this file out of Client Component imports; storage keys and credentials
// must never reach the browser bundle.
//
// Security invariant: the R2 bucket is assumed to be PRIVATE. All objects are
// served through authenticated app routes (preview, publish proxy). Storage
// keys embed project/version UUIDs and are not considered secret on their own,
// but leaking them is a defence-in-depth concern if the bucket ever gets
// reconfigured — keep access control at the route layer, not via URL secrecy.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Lazy-initialised S3 client pointed at Cloudflare R2
// ---------------------------------------------------------------------------

let client: S3Client | null = null;

function getRequiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function getR2Client(): S3Client {
  if (client) return client;

  const accountId = getRequiredEnv("R2_ACCOUNT_ID");

  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: getRequiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });

  return client;
}

export function getBucketName(): string {
  return process.env.R2_BUCKET_NAME ?? "generated-sites";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Upload a file to R2. Throws on failure. */
export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** Download a file from R2. Returns null if the key does not exist. */
export async function downloadFile(key: string): Promise<Buffer | null> {
  try {
    const res = await getR2Client().send(
      new GetObjectCommand({ Bucket: getBucketName(), Key: key }),
    );
    if (!res.Body) return null;
    return Buffer.from(await res.Body.transformToByteArray());
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "name" in err &&
      err.name === "NoSuchKey"
    ) {
      return null;
    }
    throw err;
  }
}

/**
 * List all object keys under a prefix. Handles pagination automatically.
 * R2's ListObjectsV2 is recursive by default — no manual subdirectory
 * traversal needed (unlike Supabase Storage's list).
 */
export async function listFiles(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await getR2Client().send(
      new ListObjectsV2Command({
        Bucket: getBucketName(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    if (res.Contents) {
      for (const obj of res.Contents) {
        if (obj.Key) keys.push(obj.Key);
      }
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

/**
 * Copy an object within the same bucket. Used when publishing a site so the
 * public `published/{slug}/...` path is a server-side copy of the private
 * `projects/{id}/versions/{id}/...` path — no round-trip through the Node
 * runtime required.
 */
export async function copyFile(
  sourceKey: string,
  destinationKey: string,
): Promise<void> {
  const bucket = getBucketName();
  await getR2Client().send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${sourceKey}`,
      Key: destinationKey,
    }),
  );
}

/** Delete multiple objects from R2 in a single batch request. */
export async function deleteFiles(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  // DeleteObjectsCommand supports up to 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await getR2Client().send(
      new DeleteObjectsCommand({
        Bucket: getBucketName(),
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      }),
    );
  }
}
