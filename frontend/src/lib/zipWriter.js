/**
 * A minimal ZIP writer, stored (uncompressed), in the browser.
 *
 * There is no zip dependency in this project and this needs to write a handful
 * of small text files, so the container is assembled here — the same choice
 * the ICO writer in lib/imageConvert.js makes, and for the same reason.
 *
 * "Stored" rather than deflated is deliberate. Label files are a few hundred
 * bytes of digits each; the compression would save little and would mean
 * carrying a deflate implementation for it. Every unzip tool reads method 0.
 */

/** Standard CRC-32 (IEEE 802.3), table built once on first use. */
let crcTable = null;

const crc32 = (bytes) => {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }

  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const encoder = new TextEncoder();

/**
 * @param files [{ name, text }] — name may contain forward slashes for folders
 * @returns {Blob} an application/zip blob
 */
export const buildZip = (files) => {
  const entries = files.map((file) => ({
    nameBytes: encoder.encode(file.name),
    data: typeof file.text === 'string' ? encoder.encode(file.text) : file.text,
  }));

  const chunks = [];
  const directory = [];
  let offset = 0;

  entries.forEach((entry) => {
    const crc = crc32(entry.data);
    const local = new DataView(new ArrayBuffer(30));

    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    // Bit 11 says the name is UTF-8, which is what TextEncoder produced.
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); // method 0 = stored
    local.setUint16(10, 0, true); // time — left at zero rather than invented
    local.setUint16(12, 0, true); // date
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.data.length, true); // compressed size
    local.setUint32(22, entry.data.length, true); // uncompressed size
    local.setUint16(26, entry.nameBytes.length, true);
    local.setUint16(28, 0, true); // extra field length

    chunks.push(new Uint8Array(local.buffer), entry.nameBytes, entry.data);

    directory.push({ entry, crc, offset });
    offset += 30 + entry.nameBytes.length + entry.data.length;
  });

  const directoryStart = offset;

  directory.forEach(({ entry, crc, offset: localOffset }) => {
    const central = new DataView(new ArrayBuffer(46));

    central.setUint32(0, 0x02014b50, true); // central directory header
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed
    central.setUint16(8, 0x0800, true); // UTF-8 name
    central.setUint16(10, 0, true); // method 0 = stored
    central.setUint16(12, 0, true); // time
    central.setUint16(14, 0, true); // date
    central.setUint32(16, crc, true);
    central.setUint32(20, entry.data.length, true);
    central.setUint32(24, entry.data.length, true);
    central.setUint16(28, entry.nameBytes.length, true);
    central.setUint16(30, 0, true); // extra
    central.setUint16(32, 0, true); // comment
    central.setUint16(34, 0, true); // disk number
    central.setUint16(36, 0, true); // internal attributes
    central.setUint32(38, 0, true); // external attributes
    central.setUint32(42, localOffset, true);

    chunks.push(new Uint8Array(central.buffer), entry.nameBytes);
    offset += 46 + entry.nameBytes.length;
  });

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(4, 0, true); // this disk
  end.setUint16(6, 0, true); // disk with the directory
  end.setUint16(8, directory.length, true);
  end.setUint16(10, directory.length, true);
  end.setUint32(12, offset - directoryStart, true); // directory size
  end.setUint32(16, directoryStart, true); // directory offset
  end.setUint16(20, 0, true); // comment length

  chunks.push(new Uint8Array(end.buffer));

  return new Blob(chunks, { type: 'application/zip' });
};
