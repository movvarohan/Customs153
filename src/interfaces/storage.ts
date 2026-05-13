// BlobStorage interface. Local adapter writes to a directory; R2 adapter later.

export interface BlobObject {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  contentType: string | null;
  size: number;
}

export interface BlobStorage {
  put(
    key: string,
    body: ArrayBuffer | Uint8Array | string,
    contentType: string,
  ): Promise<void>;
  get(key: string): Promise<BlobObject | null>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}
