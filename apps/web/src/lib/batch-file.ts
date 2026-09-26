/**
 * Reads a file of job-description-and-company pairs for creating several kits at once. The
 * format is the batch command's input (`[{ "id"?, "jd", "company_url", "days" }]`), so the
 * same cases file works in the app and on the command line. Every row is validated with the
 * schema the API uses; a bad row is reported and skipped, never sent.
 */
import { PipelineInputSchema, type PipelineInput } from '@prepforge/shared';

export const MAX_BATCH_ROWS = 10;
export const MAX_BATCH_FILE_BYTES = 1_000_000;

export interface BatchRow {
  /** Position in the file, from 1. */
  index: number;
  /** The row's "id" when the file gives one, otherwise "Row n". */
  label: string;
  company: string;
  /** First line of the job description, for recognising the row. */
  title: string;
  input: PipelineInput | null;
  error: string | null;
}

export type BatchParseResult = { ok: true; rows: BatchRow[] } | { ok: false; error: string };

export const BATCH_EXAMPLE = [
  {
    id: 'backend-role',
    jd: 'Senior Backend Engineer\n\nRequirements\n- 5+ years of backend development\n- Strong TypeScript and Node.js\n\nNice to have\n- Experience with Go',
    company_url: 'https://example.com',
    days: 5,
  },
  {
    id: 'frontend-role',
    jd: 'Frontend Engineer\n\nRequirements\n- 3+ years of React\n- Accessible, responsive UI\n\nNice to have\n- Design systems',
    company_url: 'https://example.org',
    days: 7,
  },
];

function hostOf(url: unknown): string {
  if (typeof url !== 'string') return '—';
  try {
    return new URL(url.trim()).host.replace(/^www\./, '');
  } catch {
    return url.trim() || '—';
  }
}

export function parseBatchFile(text: string): BatchParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  if (!Array.isArray(data)) {
    return {
      ok: false,
      error: 'The file must contain a JSON array of { "jd", "company_url", "days" } entries.',
    };
  }
  if (data.length === 0) return { ok: false, error: 'The file has no entries.' };
  if (data.length > MAX_BATCH_ROWS) {
    return {
      ok: false,
      error: `The file has ${data.length} entries; upload at most ${MAX_BATCH_ROWS} at a time.`,
    };
  }

  const rows = data.map((item: unknown, i): BatchRow => {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const days = typeof entry.days === 'string' ? Number(entry.days) : entry.days;
    const parsed = PipelineInputSchema.safeParse({
      jd: entry.jd,
      company_url: entry.company_url,
      days,
    });
    const jd = typeof entry.jd === 'string' ? entry.jd.trim() : '';
    return {
      index: i + 1,
      label: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `Row ${i + 1}`,
      company: hostOf(entry.company_url),
      title: jd.split('\n')[0]?.slice(0, 80) ?? '',
      input: parsed.success ? parsed.data : null,
      error: parsed.success
        ? null
        : [...new Set(parsed.error.issues.map((issue) => fieldMessage(issue)))].join(' '),
    };
  });
  return { ok: true, rows };
}

function fieldMessage(issue: { path: PropertyKey[]; message: string }): string {
  const field = String(issue.path[0] ?? '');
  // zod's own wording for a missing or wrongly typed field is not user-friendly
  if (/expected|received/i.test(issue.message)) {
    return `"${field}" is missing or has the wrong type.`;
  }
  return issue.message;
}
