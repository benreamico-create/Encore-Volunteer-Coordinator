import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { File, Storage } from "@google-cloud/storage";
import { canAccessObject, getObjectAclPolicy, setObjectAclPolicy, type ObjectAclPolicy, ObjectPermission } from "./objectAcl";

const SIDECAR = "http://127.0.0.1:1106";
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`, type: "external_account",
    credential_source: { url: `${SIDECAR}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});
export class ObjectNotFoundError extends Error {
  constructor() { super("Object not found"); this.name = "ObjectNotFoundError"; }
}
function parseObjectPath(path: string) {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  if (parts.length < 3) throw new Error("Invalid object path");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}
async function signObjectURL(bucketName: string, objectName: string, method: "PUT" | "GET" | "DELETE", ttlSec = 900) {
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket_name: bucketName, object_name: objectName, method, expires_at: new Date(Date.now() + ttlSec * 1000).toISOString() }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not create upload URL (${response.status})`);
  const result = await response.json() as { signed_url: string };
  return result.signed_url;
}
export class ObjectStorageService {
  private privateDir() {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not configured");
    return dir.endsWith("/") ? dir : `${dir}/`;
  }
  async getObjectEntityUploadURL() {
    const fullPath = `${this.privateDir()}uploads/${randomUUID()}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return signObjectURL(bucketName, objectName, "PUT");
  }
  normalizeObjectEntityPath(rawPath: string) {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;
    const path = new URL(rawPath).pathname;
    const prefix = this.privateDir();
    return path.startsWith(prefix) ? `/objects/${path.slice(prefix.length)}` : path;
  }
  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const { bucketName, objectName } = parseObjectPath(`${this.privateDir()}${objectPath.slice("/objects/".length)}`);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }
  async downloadObjectEntity(objectPath: string): Promise<Response> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const { bucketName, objectName } = parseObjectPath(`${this.privateDir()}${objectPath.slice("/objects/".length)}`);
    const url = await signObjectURL(bucketName, objectName, "GET", 120);
    return fetch(url, { signal: AbortSignal.timeout(30_000) });
  }
  async deleteObjectEntity(objectPath: string) {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const { bucketName, objectName } = parseObjectPath(`${this.privateDir()}${objectPath.slice("/objects/".length)}`);
    const url = await signObjectURL(bucketName, objectName, "DELETE", 120);
    const response = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
    if (!response.ok && response.status !== 404) throw new Error(`Could not delete map image (${response.status})`);
  }
  async downloadObject(file: File, cacheTtlSec = 0): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const body = Readable.toWeb(file.createReadStream()) as ReadableStream;
    return new Response(body, { headers: {
      "Content-Type": String(metadata.contentType || "application/octet-stream"),
      "Cache-Control": `private, max-age=${cacheTtlSec}`,
      ...(metadata.size ? { "Content-Length": String(metadata.size) } : {}),
      "X-Content-Type-Options": "nosniff",
    } });
  }
  async canAccessObjectEntity({ userId, objectFile, requestedPermission }: {
    userId?: string; objectFile: File; requestedPermission?: ObjectPermission;
  }) {
    return canAccessObject({ userId, objectFile, requestedPermission: requestedPermission ?? ObjectPermission.READ });
  }
  async trySetObjectEntityAclPolicy(rawPath: string, policy: ObjectAclPolicy) {
    const normalized = this.normalizeObjectEntityPath(rawPath);
    await setObjectAclPolicy(await this.getObjectEntityFile(normalized), policy);
    return normalized;
  }
  async getObjectAclPolicy(objectFile: File) { return getObjectAclPolicy(objectFile); }
}
