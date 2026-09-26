import type { ResearchBundle, ResearchPage } from '@prepforge/shared';
import { describe, expect, it } from 'vitest';
import { planQuestions } from '../src/generation/question-plan';
import { findInterviewProcess } from '../src/research/interview-process';

const page = (source_type: ResearchPage['source_type'], text: string, ok = true) =>
  ({
    url: `https://acme.com/${source_type}`,
    title: source_type,
    text,
    source_type,
    fetch_status: ok ? 'ok' : 'timeout',
  }) as ResearchPage;

const bundle = (
  pages: ResearchPage[],
  results: { url: string; title: string; snippet: string }[] = [],
) =>
  ({
    pages,
    public_research: { status: results.length ? 'found' : 'not_found', results },
  }) as unknown as ResearchBundle;

const ACME_PROCESS =
  'How we interview engineers. A 90-minute technical session: either a take-home exercise or live pairing on a small service. A system design conversation about a real problem. A values interview with an engineering manager.';

describe('findInterviewProcess', () => {
  it('finds the formats an interview page describes', () => {
    const found = findInterviewProcess(bundle([page('interview', ACME_PROCESS)]));
    expect(found.formats).toEqual(['take-home', 'live-coding', 'system-design', 'behavioural']);
    expect(found.sources.map((s) => s.label)).toEqual(['INTERVIEW_PROCESS_1']);
  });

  it('reads public discussion of the interview process too', () => {
    const found = findInterviewProcess(
      bundle(
        [],
        [
          {
            url: 'https://example.com/acme-interview',
            title: 'Acme interview process',
            snippet: 'Candidates report an online coding test followed by a system design round.',
          },
        ],
      ),
    );
    expect(found.formats).toEqual(['take-home', 'system-design']);
    expect(found.sources[0]!.label).toBe('INTERVIEW_DISCUSSION_1');
  });

  it('ignores marketing pages and careers pages that only list jobs', () => {
    const found = findInterviewProcess(
      bundle([
        page('homepage', 'Our platform makes system design and live coding easy for teams.'),
        page('careers', 'Open roles: Backend Engineer, Designer. Apply now.'),
        page('interview', ACME_PROCESS, false), // failed fetch
      ]),
    );
    expect(found).toEqual({ formats: [], sources: [] });
  });

  it('uses a careers page that describes the hiring process', () => {
    const found = findInterviewProcess(
      bundle([page('careers', 'Our interview process: a take-home task, then a chat.')]),
    );
    expect(found.formats).toEqual(['take-home']);
  });
});

describe('planQuestions with a published system design round', () => {
  const requirements = [
    { id: 'r1', text: 'Node.js', kind: 'technical' as const, priority: 'must' as const },
  ];
  it('plans one more system design question', () => {
    const count = (formats?: ('system-design' | 'take-home')[]) =>
      planQuestions(requirements, 'Senior', {
        researchIsThin: false,
        interviewFormats: formats,
      }).find((p) => p.category === 'system-design')!.count;
    expect(count()).toBe(3);
    expect(count(['take-home'])).toBe(3);
    expect(count(['system-design'])).toBe(4);
  });
});
