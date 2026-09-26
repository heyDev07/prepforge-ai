import { describe, expect, it } from 'vitest';
import { BATCH_EXAMPLE, MAX_BATCH_ROWS, parseBatchFile } from '../src/lib/batch-file';

const jd = 'Backend engineer. Requirements: TypeScript, Node.js and PostgreSQL.';

describe('parseBatchFile', () => {
  it('accepts the batch command format, including its "id" field', () => {
    const result = parseBatchFile(
      JSON.stringify([{ id: 'case-01', jd, company_url: 'https://www.acme.com/', days: 5 }]),
    );
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          index: 1,
          label: 'case-01',
          company: 'acme.com',
          title: jd,
          input: { jd, company_url: 'https://www.acme.com/', days: 5 },
          error: null,
        },
      ],
    });
  });

  it('parses the example file it offers for download', () => {
    const result = parseBatchFile(JSON.stringify(BATCH_EXAMPLE));
    expect(result.ok && result.rows.every((row) => row.input !== null)).toBe(true);
  });

  it('reports invalid rows one by one instead of rejecting the file', () => {
    const result = parseBatchFile(
      JSON.stringify([
        { jd, company_url: 'https://acme.com', days: '3' }, // days as text is fine
        { jd: 'too short', company_url: 'ftp://acme.com', days: 90 },
        { company_url: 'https://acme.com', days: 2 },
      ]),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]).toMatchObject({ label: 'Row 1', error: null, input: { days: 3 } });
    expect(result.rows[1]!.input).toBeNull();
    expect(result.rows[1]!.error).toContain('at least 20 characters');
    expect(result.rows[1]!.error).toContain('valid http(s) URL');
    expect(result.rows[1]!.error).toContain('between 1 and 60');
    expect(result.rows[2]!.error).toBe('"jd" is missing or has the wrong type.');
  });

  it.each([
    ['not json', 'The file is not valid JSON.'],
    ['{"jd": "x"}', 'The file must contain a JSON array'],
    ['[]', 'The file has no entries.'],
    [JSON.stringify(Array(MAX_BATCH_ROWS + 1).fill({})), `at most ${MAX_BATCH_ROWS}`],
  ])('rejects %s', (text, message) => {
    const result = parseBatchFile(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});
