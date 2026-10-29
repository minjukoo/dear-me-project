const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // Below Vercel's 4.5 MB response limit.
function wavInfo(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('INVALID_WAV');
  let format, dataBytes;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) throw new Error('TRUNCATED_WAV');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('INVALID_WAV');
      format = { encoding: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2), sampleRate: buffer.readUInt32LE(start + 4), byteRate: buffer.readUInt32LE(start + 8), align: buffer.readUInt16LE(start + 12), bits: buffer.readUInt16LE(start + 14) };
    }
    if (id === 'data') dataBytes = size;
    offset = start + size + (size % 2);
  }
  if (!format || dataBytes === undefined || !dataBytes || format.encoding !== 1 || format.bits !== 16 || ![1, 2].includes(format.channels) || format.sampleRate < 8000 || format.sampleRate > 96000 || format.align !== format.channels * 2 || format.byteRate !== format.sampleRate * format.align || dataBytes % format.align) throw new Error('UNSUPPORTED_WAV');
  return { durationSeconds: dataBytes / format.byteRate, sampleRate: format.sampleRate, channels: format.channels, bitsPerSample: 16 };
}
function normalizeAudio(buffer, contentType) {
  if (!buffer.length || buffer.length > MAX_AUDIO_BYTES) throw new Error('INVALID_AUDIO_SIZE');
  if (buffer.toString('ascii', 0, 4) === 'RIFF') return { buffer, ...wavInfo(buffer), pcmFormatAssumed: false };
  // The gateway's raw PCM contract still needs confirmation against its test output.
  // Do not mistake JSON, HTML, MP3 or big-endian L16 for little-endian PCM.
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (!['audio/pcm', 'audio/raw', 'application/octet-stream'].includes(type)) throw new Error('UNSUPPORTED_AUDIO_TYPE');
  const first = buffer.subarray(0, 32).toString('utf8').trimStart();
  if (/^[{<[]/.test(first) || buffer.toString('ascii', 0, 3) === 'ID3') throw new Error('INVALID_PCM');
  if (buffer.length % 2 || buffer.length + 44 > MAX_AUDIO_BYTES) throw new Error('INVALID_PCM');
  const rate = /(?:rate|samplerate)\s*=\s*(\d+)/i.exec(contentType);
  const channels = /channels\s*=\s*(\d+)/i.exec(contentType);
  if ((rate && +rate[1] !== 24000) || (channels && +channels[1] !== 1)) throw new Error('UNSUPPORTED_PCM_FORMAT');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(buffer.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(buffer.length, 40);
  const wav = Buffer.concat([header, buffer]);
  return { buffer: wav, ...wavInfo(wav), pcmFormatAssumed: true };
}
async function readLimited(response) {
  if (Number(response.headers.get('content-length')) > MAX_AUDIO_BYTES) throw new Error('AUDIO_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('EMPTY_AUDIO');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_AUDIO_BYTES) { await reader.cancel(); throw new Error('AUDIO_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
module.exports = { MAX_AUDIO_BYTES, wavInfo, normalizeAudio, readLimited };
