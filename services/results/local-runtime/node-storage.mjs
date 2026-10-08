import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

function sqliteValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('SQLite bindings must be strings, finite numbers, bigint, null, or bytes');
}

class SqliteStatement {
  constructor(owner, sql, args = []) {
    this.owner = owner;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new SqliteStatement(this.owner, this.sql, args.map(sqliteValue));
  }
  async first() {
    return this.owner.sqlite.prepare(this.sql).get(...this.args) ?? null;
  }
  async all() {
    return { results: this.owner.sqlite.prepare(this.sql).all(...this.args) };
  }
  runSync() {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(result.changes) } };
  }
  async run() {
    return this.runSync();
  }
}

// Keep the complete batch synchronous between BEGIN and COMMIT. In particular,
// changes() in a later statement must observe the immediately preceding write.
export class SqliteDatabase {
  constructor(filename) {
    this.sqlite = new DatabaseSync(filename);
    this.sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  }
  prepare(sql) {
    return new SqliteStatement(this, sql);
  }
  async batch(statements) {
    for (const statement of statements) {
      if (!(statement instanceof SqliteStatement) || statement.owner !== this)
        throw new TypeError('A SQLite batch must use statements prepared by the same database');
    }
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      // SQLite can already have rolled back on disk, I/O, or memory errors.
      // A failed cleanup must not replace the original transaction failure.
      try { this.sqlite.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }
  close() {
    this.sqlite.close();
  }
}

function safeKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > 1024 ||
      !key.split('/').every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) &&
        !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    throw new TypeError('Invalid local object key');
  // Keys never become filesystem paths, including on Windows.
  return createHash('sha256').update(key).digest('hex');
}

async function valueBytes(value) {
  if (value === null) return Buffer.alloc(0);
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255))
    return Buffer.from(value);
  if (value && typeof value.arrayBuffer === 'function') return Buffer.from(await value.arrayBuffer());
  if (value && typeof value.getReader === 'function') {
    const chunks = [];
    const reader = value.getReader();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(await valueBytes(part.value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }
  if (value && typeof value[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const part of value) chunks.push(await valueBytes(part));
    return Buffer.concat(chunks);
  }
  throw new TypeError('Unsupported local object body');
}

const MAGIC = Buffer.from('JYR2');
const metadataHeaders = {
  contentType: 'Content-Type', contentLanguage: 'Content-Language',
  contentDisposition: 'Content-Disposition', contentEncoding: 'Content-Encoding',
  cacheControl: 'Cache-Control', cacheExpiry: 'Expires',
};

function objectInfo(metadata, size) {
  return {
    key: metadata.key,
    version: metadata.version,
    size,
    etag: metadata.etag,
    httpEtag: `"${metadata.etag}"`,
    uploaded: new Date(metadata.uploaded),
    httpMetadata: metadata.httpMetadata,
    customMetadata: metadata.customMetadata,
    writeHttpMetadata(headers) {
      for (const [key, name] of Object.entries(metadataHeaders)) {
        const value = metadata.httpMetadata[key];
        if (value !== undefined) headers.set(name, String(value));
      }
    },
  };
}

// One atomic file contains metadata and body, so readers cannot see a body from
// one upload paired with metadata from another. No native addon is needed.
export class FilesystemBucket {
  constructor(directory) {
    this.directory = resolve(directory);
  }
  async read(key) {
    const filename = join(this.directory, `${safeKey(key)}.object`);
    let bytes;
    try {
      bytes = await readFile(filename);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (bytes.length < 8 || !bytes.subarray(0, 4).equals(MAGIC))
      throw new Error('Local object header is damaged');
    const length = bytes.readUInt32BE(4);
    if (length > bytes.length - 8) throw new Error('Local object metadata is damaged');
    const metadata = JSON.parse(bytes.subarray(8, 8 + length).toString('utf8'));
    if (metadata.key !== key) throw new Error('Local object key does not match its metadata');
    return { metadata, bytes: bytes.subarray(8 + length) };
  }
  async head(key) {
    const value = await this.read(key);
    return value ? objectInfo(value.metadata, value.bytes.length) : null;
  }
  async get(key) {
    const value = await this.read(key);
    if (!value) return null;
    const bytes = new Uint8Array(value.bytes);
    const response = new Response(bytes, { headers: {
      'Content-Type': value.metadata.httpMetadata.contentType ?? 'application/octet-stream',
    } });
    return {
      ...objectInfo(value.metadata, bytes.length), body: response.body,
      get bodyUsed() { return response.bodyUsed; },
      async arrayBuffer() { return response.arrayBuffer(); },
      async text() { return response.text(); },
      async json() { return response.json(); },
      async blob() { return response.blob(); },
    };
  }
  async put(key, value, options = {}) {
    const basename = safeKey(key);
    const bytes = await valueBytes(value);
    const httpMetadata = {};
    for (const name of Object.keys(metadataHeaders)) {
      const item = options.httpMetadata?.[name];
      if (item !== undefined) {
        const text = item instanceof Date ? item.toUTCString() : String(item);
        if (/[\r\n]/.test(text)) throw new TypeError('Invalid object HTTP metadata');
        httpMetadata[name] = text;
      }
    }
    const metadata = {
      key, version: randomUUID(), uploaded: new Date().toISOString(),
      etag: createHash('md5').update(bytes).digest('hex'), httpMetadata,
      customMetadata: options.customMetadata ?? {},
    };
    const encoded = Buffer.from(JSON.stringify(metadata));
    const header = Buffer.alloc(8);
    MAGIC.copy(header);
    header.writeUInt32BE(encoded.length, 4);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `${basename}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, Buffer.concat([header, encoded, bytes]), { flag: 'wx', mode: 0o600 });
      await rename(temporary, join(this.directory, `${basename}.object`));
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    return objectInfo(metadata, bytes.length);
  }
}
