export class Writer {
  private buf: number[] = [];
  static create(): Writer { return new Writer(); }

  uint32(value: number): Writer {
    while (value > 0x7f) { this.buf.push((value & 0x7f) | 0x80); value >>>= 7; }
    this.buf.push(value & 0x7f);
    return this;
  }

  int32(value: number): Writer {
    if (value < 0) value = (1 << 32) + value;
    return this.uint32(value);
  }

  int64(value: number | string): Writer {
    let num = typeof value === 'string' ? parseInt(value) : value;
    if (num < 0) num = Number(BigInt(1) << BigInt(64)) + num;
    return this.uint32(num);
  }

  string(value: string): Writer {
    const data = new TextEncoder().encode(value);
    this.uint32(data.length);
    this.buf.push(...data);
    return this;
  }

  bool(value: boolean): Writer { return this.uint32(value ? 1 : 0); }

  bytes(value: Uint8Array | number[]): Writer {
    const arr = value instanceof Uint8Array ? Array.from(value) : value;
    this.uint32(arr.length);
    this.buf.push(...arr);
    return this;
  }

  fixed32(value: number): Writer {
    this.buf.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
    return this;
  }

  fixed64(value: number): Writer {
    this.fixed32(value & 0xffffffff);
    this.fixed32(Math.floor(value / 0x100000000));
    return this;
  }

  finish(): Uint8Array { return new Uint8Array(this.buf); }
}

export class Reader {
  private buf: Uint8Array;
  public pos = 0;
  public len: number;

  constructor(data: Uint8Array) { this.buf = data; this.len = data.length; }
  static create(data: Uint8Array): Reader { return new Reader(data); }

  private readVarint(): bigint {
    let result = BigInt(0), shift = BigInt(0), maxBytes = 10;
    while (maxBytes-- > 0 && this.pos < this.len) {
      const byte = this.buf[this.pos++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) break;
      shift += BigInt(7);
    }
    return result;
  }

  uint32(): number { return Number(this.readVarint() & BigInt(0xffffffff)); }

  int64(): number | string {
    const value = this.readVarint();
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) return value.toString();
    return Number(value);
  }

  fixed64(): number {
    const low = this.fixed32(), high = this.fixed32();
    return low + high * 0x100000000;
  }

  bytes(): Uint8Array {
    const length = this.uint32();
    const data = this.buf.slice(this.pos, this.pos + length);
    this.pos += length;
    return data;
  }

  fixed32(): number {
    const data = this.buf.slice(this.pos, this.pos + 4);
    this.pos += 4;
    return data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
  }
}

export class Protobuf {
  encode(obj: Record<number, unknown>): Uint8Array {
    const writer = Writer.create();
    for (const tag of Object.keys(obj).map(Number).sort((a, b) => a - b)) {
      this._encode(writer, tag, obj[tag]);
    }
    return writer.finish();
  }

  private _encode(writer: Writer, tag: number, value: unknown): void {
    if (value === null || value === undefined) return;
    if (typeof value === 'number' && !Number.isInteger(value)) return;

    if (typeof value === 'boolean') {
      writer.uint32((tag << 3) | 0).bool(value);
    } else if (typeof value === 'number') {
      writer.uint32((tag << 3) | 0)[Math.abs(value) > 2147483647 ? 'int64' : 'int32'](value);
    } else if (typeof value === 'string') {
      writer.uint32((tag << 3) | 2).string(value);
    } else if (value instanceof Uint8Array) {
      writer.uint32((tag << 3) | 2).bytes(value);
    } else if (Array.isArray(value)) {
      for (const item of value) this._encode(writer, tag, item);
    } else if (typeof value === 'object') {
      writer.uint32((tag << 3) | 2).bytes(this.encode(value as Record<number, unknown>));
    }
  }

  decode(buffer: Uint8Array | string): Record<number, unknown> {
    if (typeof buffer === 'string') buffer = this.hexToBytes(buffer);
    const result: Record<number, unknown> = {};
    const reader = Reader.create(buffer);

    while (reader.pos < reader.len) {
      const k = reader.uint32(), tag = k >> 3, wireType = k & 0b111;
      let value: unknown;

      if (wireType === 0) {
        value = this.long2int(reader.int64());
      } else if (wireType === 1) {
        value = this.long2int(reader.fixed64());
      } else if (wireType === 2) {
        const bytes = reader.bytes();
        try {
          const decoded = this.decode(bytes);
          value = this._shouldKeepAsString(decoded, bytes) ? this._bytesToReadableString(bytes) : decoded;
        } catch { value = this._bytesToReadableString(bytes); }
      } else if (wireType === 5) {
        value = reader.fixed32();
      } else {
        throw new Error(`Unsupported wire type: ${wireType}`);
      }

      if (tag in result) {
        const existing = result[tag];
        result[tag] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        result[tag] = value;
      }
    }
    return result;
  }

  private _bytesToReadableString(bytes: Uint8Array): string {
    try {
      const str = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (this._isReadableString(str)) return str;
    } catch {}
    return 'hex->' + this.bytesToHex(bytes);
  }

  private _isReadableString(str: string): boolean {
    if (!str) return false;
    let badChars = 0;
    for (const char of str) {
      const code = char.charCodeAt(0);
      if ((code < 32 && ![9, 10, 13].includes(code)) || (code >= 0x7f && code < 0xa0) || code === 0xfffd) badChars++;
    }
    return badChars <= 3 && (str.length === 0 || badChars / str.length <= 0.1);
  }

  private _shouldKeepAsString(decoded: Record<number, unknown>, originalBytes: Uint8Array): boolean {
    try {
      const str = new TextDecoder().decode(originalBytes);
      if (new TextEncoder().encode(str).length !== originalBytes.length) return false;
      if (this._hasTooManyControlChars(str)) return false;
      return this._looksLikeMisdecodedString(decoded);
    } catch { return false; }
  }

  private _hasTooManyControlChars(text: string): boolean {
    if (!text) return false;
    let count = 0;
    for (const char of text) {
      const code = char.charCodeAt(0);
      if ((code < 32 && ![10, 13, 9].includes(code)) || (code >= 0x7f && code < 0xa0)) count++;
    }
    return count / text.length > 0.05 || count > 10;
  }

  private _looksLikeMisdecodedString(value: Record<number, unknown>): boolean {
    const keys = Object.keys(value), keyCount = keys.length;
    if (keyCount < 1 || keyCount > 4) return false;
    for (const key of keys) if (Math.abs(parseInt(key)) > 1000000) return true;

    let hasString = false, hasList = false, hasNestedDict = false, simpleTypeCount = 0;
    for (const key of keys) {
      const val = value[parseInt(key)];
      if (typeof val === 'string') { hasString = true; simpleTypeCount++; }
      else if (typeof val === 'number' || typeof val === 'boolean') simpleTypeCount++;
      else if (Array.isArray(val)) { hasList = true; if (val.some(i => typeof i === 'object' && i !== null)) hasNestedDict = true; }
      else if (typeof val === 'object' && val !== null) hasNestedDict = true;
    }
    return (hasString && hasList && !hasNestedDict) || (simpleTypeCount === keyCount && keyCount <= 3) ||
           (hasString && simpleTypeCount >= keyCount - 1 && keyCount <= 3 && !hasNestedDict);
  }

  private long2int(value: number | string): number | string {
    if (typeof value === 'string') return value;
    return Math.abs(value) <= 9007199254740991 ? value : value.toString();
  }

  hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    return bytes;
  }

  bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

export const pb = new Protobuf();
export const randomUint = () => Math.floor(Math.random() * 0xffffffff);

export function processJson(data: unknown): Record<number, unknown> {
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return {}; } }
  return processJsonRecursive(data);
}

function processJsonRecursive(obj: unknown): Record<number, unknown> {
  if (obj instanceof Uint8Array) return obj as unknown as Record<number, unknown>;
  if (Array.isArray(obj)) return obj.map(item => processJsonRecursive(item)) as unknown as Record<number, unknown>;
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<number, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const numKey = parseInt(key);
      if (isNaN(numKey)) continue;
      if (typeof value === 'string' && value.startsWith('hex->')) {
        const hexStr = value.slice(5);
        result[numKey] = /^[0-9a-fA-F]+$/.test(hexStr) && hexStr.length % 2 === 0 ? pb.hexToBytes(hexStr) : value;
      } else if (typeof value === 'object') {
        result[numKey] = processJsonRecursive(value);
      } else {
        result[numKey] = value;
      }
    }
    return result;
  }
  return obj as Record<number, unknown>;
}

export function jsonDumpsWithBytes(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => value instanceof Uint8Array ? `hex->${pb.bytesToHex(value)}` : value, 2);
}
