import type { Kit } from '../src';

/** A small but complete kit that satisfies Appendix A. Tests mutate copies of it. */
export function makeValidKit(): Kit {
  return {
    source: {
      company: 'Acme',
      company_url: 'https://acme.example',
      role: 'Backend Engineer',
      location: 'Remote (EU)',
      jd_chars: 1234,
      researched_at: '2026-09-23T10:00:00.000Z',
      pages_used: ['https://acme.example/', 'https://acme.example/careers'],
    },
    company_brief: {
      summary: 'Acme builds logistics software for mid-size retailers.',
      what_they_do: 'Route planning and warehouse APIs.',
      sources: ['https://acme.example/'],
    },
    role: {
      title: 'Backend Engineer',
      seniority: 'Senior',
      responsibilities: ['Design and operate Node.js services'],
      requirements: [
        { id: 'r1', text: '5+ years of Node.js', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'must' },
        { id: 'r3', text: 'Experience with logistics', kind: 'domain', priority: 'nice' },
      ],
    },
    questions: [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'How does the Node.js event loop handle blocking work?',
        answer_outline: 'Phases, libuv thread pool, worker threads.',
        difficulty: 2,
      },
      {
        id: 'q2',
        requirement_ids: ['r2'],
        category: 'behavioural',
        prompt: 'Tell me about a time you mentored someone.',
        answer_outline: 'STAR: situation, task, action, result.',
        difficulty: 1,
      },
    ],
    flashcards: [
      {
        id: 'f1',
        front: 'What runs on the libuv thread pool?',
        back: 'fs, dns.lookup, crypto, zlib',
        requirement_ids: ['r1'],
      },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: 'Technical: Node.js', question_ids: ['q1'], minutes: 25 },
        { day: 2, focus: 'Behavioural: mentoring', question_ids: ['q2'], minutes: 20 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}
