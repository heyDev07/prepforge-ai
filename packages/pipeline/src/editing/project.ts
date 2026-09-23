/**
 * InternalKit → exact Appendix A kit. Built field by field so editing metadata
 * (state, origin, counters) can never leak into the exported JSON.
 */
import type { InternalKit, Kit } from '@prepforge/shared';

export function toExternalKit(kit: InternalKit): Kit {
  return {
    source: {
      company: kit.source.company,
      company_url: kit.source.company_url,
      role: kit.source.role,
      location: kit.source.location,
      jd_chars: kit.source.jd_chars,
      researched_at: kit.source.researched_at,
      pages_used: [...kit.source.pages_used],
    },
    company_brief: {
      summary: kit.company_brief.summary,
      what_they_do: kit.company_brief.what_they_do,
      sources: [...kit.company_brief.sources],
    },
    role: {
      title: kit.role.title,
      seniority: kit.role.seniority,
      responsibilities: [...kit.role.responsibilities],
      requirements: kit.role.requirements.map((r) => ({
        id: r.id,
        text: r.text,
        kind: r.kind,
        priority: r.priority,
      })),
    },
    questions: kit.questions.map((q) => ({
      id: q.id,
      requirement_ids: [...q.requirement_ids],
      category: q.category,
      prompt: q.prompt,
      answer_outline: q.answer_outline,
      difficulty: q.difficulty,
    })),
    flashcards: kit.flashcards.map((f) => ({
      id: f.id,
      front: f.front,
      back: f.back,
      requirement_ids: [...f.requirement_ids],
    })),
    schedule: {
      days_available: kit.schedule.days_available,
      days: kit.schedule.days.map((d) => ({
        day: d.day,
        focus: d.focus,
        question_ids: [...d.question_ids],
        minutes: d.minutes,
      })),
    },
    coverage: {
      uncovered_requirement_ids: [...kit.coverage.uncovered_requirement_ids],
      passes: kit.coverage.passes,
    },
  };
}
