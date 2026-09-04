import { createReadStream } from 'node:fs';

/**
 * Read complete (newline-terminated) lines from `file` starting at `startOffset`.
 *
 * The returned offset only advances past the last newline, so a line still
 * being written when we read (the file ends mid-line) is left intact and
 * re-read on the next pass instead of being split into invalid fragments and
 * lost. Counting `byteLength(line) + 1` per emitted line instead would push the
 * offset past the partial record, and the remainder would then be re-read as a
 * fragment that fails to parse — silently dropping that event.
 *
 * A missing or unreadable file resolves to zero lines and an unchanged offset
 * so callers can treat it as "nothing new yet".
 */
export async function readLines(
  startOffset: number,
  file: string
): Promise<{ lines: string[]; newOffset: number }> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let totalBytes = 0;                    // all bytes read from startOffset to EOF
    let pending: Buffer = Buffer.alloc(0); // bytes after the last newline (incomplete line)

    const stream = createReadStream(file, { start: startOffset });
    stream.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'EACCES') resolve({ lines: [], newOffset: startOffset });
      else reject(err);
    });
    stream.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      const buf = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let start = 0;
      let nl: number;
      while ((nl = buf.indexOf(0x0a, start)) !== -1) {
        const line = buf.subarray(start, nl).toString('utf8').trim();
        if (line) lines.push(line);
        start = nl + 1;
      }
      pending = start === 0 ? buf : buf.subarray(start);
    });
    // Complete bytes = everything except the trailing incomplete line.
    stream.on('end', () => resolve({ lines, newOffset: startOffset + totalBytes - pending.length }));
  });
}
