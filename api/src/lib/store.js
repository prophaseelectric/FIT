// JSON document store. Azure Blob Storage when STORAGE_CONNECTION is set,
// otherwise a local folder (DATA_DIR, default ./.data) for development.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const CONTAINER = process.env.STORAGE_CONTAINER || 'fit';

class PreconditionFailed extends Error {
  constructor() { super('precondition failed'); this.code = 'PRECONDITION'; }
}

class BlobStore {
  constructor(conn) {
    const { BlobServiceClient } = require('@azure/storage-blob');
    this.container = BlobServiceClient.fromConnectionString(conn).getContainerClient(CONTAINER);
    this.ready = null;
  }
  async init() {
    if (!this.ready) this.ready = this.container.createIfNotExists().catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }
  async getRaw(key) {
    await this.init();
    try {
      const blob = this.container.getBlockBlobClient(key);
      const buf = await blob.downloadToBuffer();
      const props = await blob.getProperties();
      return { buf, etag: props.etag };
    } catch (e) {
      if (e.statusCode === 404) return null;
      throw e;
    }
  }
  async putRaw(key, buf, { ifMatch, ifNoneMatch, contentType = 'application/json' } = {}) {
    await this.init();
    const blob = this.container.getBlockBlobClient(key);
    const conditions = {};
    if (ifMatch) conditions.ifMatch = ifMatch;
    if (ifNoneMatch) conditions.ifNoneMatch = ifNoneMatch;
    try {
      const r = await blob.uploadData(buf, { blobHTTPHeaders: { blobContentType: contentType }, conditions });
      return r.etag;
    } catch (e) {
      if (e.statusCode === 412 || e.statusCode === 409) throw new PreconditionFailed();
      throw e;
    }
  }
  async list(prefix) {
    await this.init();
    const out = [];
    for await (const b of this.container.listBlobsFlat({ prefix })) out.push(b.name);
    return out;
  }
  async del(key) {
    await this.init();
    await this.container.getBlockBlobClient(key).deleteIfExists();
  }
}

class FileStore {
  constructor(dir) { this.dir = dir; }
  file(key) {
    const p = path.resolve(this.dir, key);
    if (!p.startsWith(path.resolve(this.dir) + path.sep)) throw new Error('bad key');
    return p;
  }
  etagOf(buf) { return '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"'; }
  async getRaw(key) {
    try {
      const buf = await fs.readFile(this.file(key));
      return { buf, etag: this.etagOf(buf) };
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  async putRaw(key, buf, { ifMatch, ifNoneMatch } = {}) {
    const cur = await this.getRaw(key);
    if (ifMatch && (!cur || cur.etag !== ifMatch)) throw new PreconditionFailed();
    if (ifNoneMatch === '*' && cur) throw new PreconditionFailed();
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    const tmp = f + '.' + process.pid + '.tmp';
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, f);
    return this.etagOf(buf);
  }
  async list(prefix) {
    const out = [];
    const walk = async (d) => {
      let ents;
      try { ents = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (!e.name.endsWith('.tmp')) out.push(path.relative(this.dir, p).split(path.sep).join('/'));
      }
    };
    await walk(this.dir);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }
  async del(key) {
    await fs.rm(this.file(key), { force: true });
  }
}

let store;
function getStore() {
  if (!store) {
    store = process.env.STORAGE_CONNECTION
      ? new BlobStore(process.env.STORAGE_CONNECTION)
      : new FileStore(process.env.DATA_DIR || path.resolve(__dirname, '../../../.data'));
  }
  return store;
}

async function getJson(key, fallback = null) {
  const r = await getStore().getRaw(key);
  if (!r) return { data: fallback, etag: null };
  return { data: JSON.parse(r.buf.toString('utf8')), etag: r.etag };
}

async function putJson(key, data, opts) {
  return getStore().putRaw(key, Buffer.from(JSON.stringify(data)), opts);
}

// Read-modify-write with optimistic concurrency. fn may mutate and return the doc.
async function updateJson(key, fallback, fn, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const { data, etag } = await getJson(key, null);
    const doc = data ?? structuredClone(fallback);
    const next = (await fn(doc)) ?? doc;
    try {
      await putJson(key, next, etag ? { ifMatch: etag } : { ifNoneMatch: '*' });
      return next;
    } catch (e) {
      if (e.code !== 'PRECONDITION') throw e;
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));
    }
  }
  throw new Error('Too much contention on ' + key);
}

module.exports = { getStore, getJson, putJson, updateJson, PreconditionFailed };
