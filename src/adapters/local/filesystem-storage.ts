// Local BlobStorage adapter. One directory per bucket. Keys may contain "/"
// for prefixes; the adapter creates intermediate directories as needed.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { BlobObject, BlobStorage } from "@/interfaces/storage";

const META_SUFFIX = ".meta.json";

interface BlobMeta {
  contentType: string | null;
}

export class FilesystemStorage implements BlobStorage {
  constructor(private readonly rootDir: string) {}

  static async open(rootDir: string): Promise<FilesystemStorage> {
    await fs.mkdir(rootDir, { recursive: true });
    return new FilesystemStorage(rootDir);
  }

  private resolve(key: string): string {
    const safe = key.replace(/^\/+/, "");
    return path.join(this.rootDir, safe);
  }

  async put(
    key: string,
    body: ArrayBuffer | Uint8Array | string,
    contentType: string,
  ): Promise<void> {
    const filePath = this.resolve(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const buf =
      typeof body === "string"
        ? Buffer.from(body, "utf8")
        : body instanceof Uint8Array
          ? Buffer.from(body)
          : Buffer.from(new Uint8Array(body));
    await fs.writeFile(filePath, buf);
    const meta: BlobMeta = { contentType };
    await fs.writeFile(filePath + META_SUFFIX, JSON.stringify(meta));
  }

  async get(key: string): Promise<BlobObject | null> {
    const filePath = this.resolve(key);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    let meta: BlobMeta = { contentType: null };
    try {
      const raw = await fs.readFile(filePath + META_SUFFIX, "utf8");
      meta = JSON.parse(raw) as BlobMeta;
    } catch {
      // metadata sidecar may be missing for blobs written by other tools
    }
    return {
      contentType: meta.contentType,
      size: stat.size,
      arrayBuffer: async () => {
        const buf = await fs.readFile(filePath);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      },
      text: async () => fs.readFile(filePath, "utf8"),
    };
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolve(key);
    await fs.rm(filePath, { force: true });
    await fs.rm(filePath + META_SUFFIX, { force: true });
  }

  async list(prefix?: string): Promise<string[]> {
    const results: string[] = [];
    const root = this.rootDir;
    const walk = async (dir: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      for (const e of entries) {
        const name = e.name;
        const full = path.join(dir, name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (!name.endsWith(META_SUFFIX)) {
          const rel = path.relative(root, full).split(path.sep).join("/");
          if (!prefix || rel.startsWith(prefix)) results.push(rel);
        }
      }
    };
    await walk(root);
    return results;
  }
}
