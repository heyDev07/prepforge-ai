import { describe, expect, it } from 'vitest';
import {
  AppError,
  BatchOutputSchema,
  GENERATION_STAGES,
  InternalKitSchema,
  PIPELINE_STAGE_SEQUENCE,
  PipelineInputSchema,
  toStructuredError,
  type InternalKit,
} from '../src';
import { makeValidKit } from './fixtures';

function makeInternalKit(): InternalKit {
  const kit = makeValidKit();
  return {
    ...kit,
    company_brief: { ...kit.company_brief, state: 'generated' },
    questions: kit.questions.map((q) => ({ ...q, state: 'generated', origin: 'generated' })),
    flashcards: kit.flashcards.map((f) => ({ ...f, state: 'generated', origin: 'generated' })),
    counters: { question: 2, flashcard: 1 },
  };
}

describe('InternalKitSchema', () => {
  it('accepts a kit with editing metadata', () => {
    expect(InternalKitSchema.safeParse(makeInternalKit()).success).toBe(true);
  });

  it('requires state and origin on questions', () => {
    const kit = makeInternalKit() as unknown as { questions: Record<string, unknown>[] };
    delete kit.questions[0]!.state;
    expect(InternalKitSchema.safeParse(kit).success).toBe(false);
  });

  it('stays strict after extension', () => {
    const kit = makeInternalKit() as unknown as Record<string, unknown>;
    kit.unexpected = true;
    expect(InternalKitSchema.safeParse(kit).success).toBe(false);
  });
});

describe('PipelineInputSchema', () => {
  const valid = {
    jd: 'Backend engineer. Node.js and PostgreSQL required.',
    company_url: 'https://acme.example',
    days: 5,
  };

  it('accepts valid input and trims strings', () => {
    const parsed = PipelineInputSchema.parse({ ...valid, company_url: '  https://acme.example  ' });
    expect(parsed.company_url).toBe('https://acme.example');
  });

  it.each([
    [{ days: 0 }],
    [{ days: 61 }],
    [{ days: 2.5 }],
    [{ company_url: 'ftp://acme.example' }],
    [{ company_url: 'not a url' }],
    [{ jd: 'too short' }],
  ])('rejects %o', (override) => {
    expect(PipelineInputSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it('accepts 1-day and 60-day schedules', () => {
    expect(PipelineInputSchema.safeParse({ ...valid, days: 1 }).success).toBe(true);
    expect(PipelineInputSchema.safeParse({ ...valid, days: 60 }).success).toBe(true);
  });
});

describe('BatchOutputSchema', () => {
  it('accepts mixed ok and failed results', () => {
    const output = {
      version: '1.0',
      generated_at: new Date().toISOString(),
      kits: [
        { id: 'case-01', status: 'ok', kit: makeValidKit(), error: null },
        {
          id: 'case-04',
          status: 'failed',
          kit: null,
          error: { code: 'COMPANY_UNREACHABLE', message: 'Homepage timed out.' },
        },
      ],
    };
    expect(BatchOutputSchema.safeParse(output).success).toBe(true);
  });

  it('rejects an ok result without a kit', () => {
    const output = {
      version: '1.0',
      generated_at: new Date().toISOString(),
      kits: [{ id: 'case-01', status: 'ok', kit: null, error: null }],
    };
    expect(BatchOutputSchema.safeParse(output).success).toBe(false);
  });
});

describe('stages', () => {
  it('keeps the exact stage sequence, including both validating steps', () => {
    expect(PIPELINE_STAGE_SEQUENCE.filter((s) => s === 'validating')).toHaveLength(2);
    expect(PIPELINE_STAGE_SEQUENCE.at(-1)).toBe('completed');
    expect(new Set(GENERATION_STAGES).size).toBe(GENERATION_STAGES.length);
  });
});

describe('structured errors', () => {
  it('serialises AppError with stage and retryable flag', () => {
    const error = new AppError('COMPANY_UNREACHABLE', 'Homepage timed out.', { retryable: true });
    expect(toStructuredError(error.atStage('researching_company'))).toEqual({
      code: 'COMPANY_UNREACHABLE',
      message: 'Homepage timed out.',
      stage: 'researching_company',
      retryable: true,
    });
  });

  it('does not leak messages from unknown errors', () => {
    const structured = toStructuredError(new Error('ECONNREFUSED 10.0.0.5:27017'), 'persisting');
    expect(structured.code).toBe('INTERNAL_ERROR');
    expect(structured.message).not.toContain('10.0.0.5');
    expect(structured.stage).toBe('persisting');
  });
});
