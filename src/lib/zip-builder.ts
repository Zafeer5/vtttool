/**
 * Minimal, zero-dependency PKZIP generator supporting uncompressed (STORE) entries.
 * Perfect for archiving pre-compressed media like MP4 video clips in sub-second speeds.
 * Compatible with Windows Explorer, macOS Archive Utility, 7-Zip, WinRAR, and unzip.
 */

// Standard CRC32 table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function computeCRC32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFileInput {
  name: string;
  data: Uint8Array | ArrayBuffer;
  date?: Date;
}

export class SimpleZipBuilder {
  private files: ZipFileInput[] = [];

  addFile(name: string, data: Uint8Array | ArrayBuffer): this {
    this.files.push({ name, data });
    return this;
  }

  build(): Uint8Array {
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [];
    const centralEntries: Uint8Array[] = [];

    let currentOffset = 0;
    const now = new Date();
    // MS-DOS date/time format
    const dosTime =
      ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate =
      (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

    for (const file of this.files) {
      const nameBytes = encoder.encode(file.name);
      const dataBytes =
        file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
      const crc = computeCRC32(dataBytes);
      const size = dataBytes.length;

      // Local File Header (30 bytes + name)
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);

      lv.setUint32(0, 0x04034b50, true); // Local file header signature
      lv.setUint16(4, 20, true); // Version needed to extract (2.0)
      lv.setUint16(6, 0, true); // General purpose bit flag
      lv.setUint16(8, 0, true); // Compression method: 0 (STORE)
      lv.setUint16(10, dosTime, true); // Last mod file time
      lv.setUint16(12, dosDate, true); // Last mod file date
      lv.setUint32(14, crc, true); // CRC-32
      lv.setUint32(18, size, true); // Compressed size
      lv.setUint32(22, size, true); // Uncompressed size
      lv.setUint16(26, nameBytes.length, true); // File name length
      lv.setUint16(28, 0, true); // Extra field length
      localHeader.set(nameBytes, 30);

      parts.push(localHeader);
      parts.push(dataBytes);

      // Central Directory Header (46 bytes + name)
      const cdHeader = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cdHeader.buffer, cdHeader.byteOffset, cdHeader.byteLength);

      cv.setUint32(0, 0x02014b50, true); // Central directory file header signature
      cv.setUint16(4, 20, true); // Version made by
      cv.setUint16(6, 20, true); // Version needed to extract
      cv.setUint16(8, 0, true); // Bit flag
      cv.setUint16(10, 0, true); // Compression method 0
      cv.setUint16(12, dosTime, true); // Mod time
      cv.setUint16(14, dosDate, true); // Mod date
      cv.setUint32(16, crc, true); // CRC-32
      cv.setUint32(20, size, true); // Comp size
      cv.setUint32(24, size, true); // Uncomp size
      cv.setUint16(28, nameBytes.length, true); // Name length
      cv.setUint16(30, 0, true); // Extra field length
      cv.setUint16(32, 0, true); // Comment length
      cv.setUint16(34, 0, true); // Disk number start
      cv.setUint16(36, 0, true); // Internal attributes
      cv.setUint32(38, 0, true); // External attributes
      cv.setUint32(42, currentOffset, true); // Relative offset of local header
      cdHeader.set(nameBytes, 46);

      centralEntries.push(cdHeader);
      currentOffset += localHeader.length + dataBytes.length;
    }

    const cdOffset = currentOffset;
    let cdSize = 0;
    for (const cd of centralEntries) {
      parts.push(cd);
      cdSize += cd.length;
    }

    // End of Central Directory Record (22 bytes)
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength);
    ev.setUint32(0, 0x06054b50, true); // EOCD signature
    ev.setUint16(4, 0, true); // Disk number
    ev.setUint16(6, 0, true); // Start disk
    ev.setUint16(8, this.files.length, true); // Entries on this disk
    ev.setUint16(10, this.files.length, true); // Total entries
    ev.setUint32(12, cdSize, true); // Size of central directory
    ev.setUint32(16, cdOffset, true); // Offset of central directory
    ev.setUint16(20, 0, true); // ZIP file comment length

    parts.push(eocd);

    // Concat into single Uint8Array
    let totalLength = 0;
    for (const p of parts) totalLength += p.length;
    const finalBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const p of parts) {
      finalBuffer.set(p, offset);
      offset += p.length;
    }

    return finalBuffer;
  }

  buildBlob(): Blob {
    const buffer = this.build();
    return new Blob([buffer as any], { type: 'application/zip' });
  }
}
