/**
 * Prompts for the generation stages. Each is small and focused on one task; all non-operator
 * content (JD-derived requirements, research, existing items) is passed as untrusted data.
 */
import type { QuestionCategory, Requirement } from '@prepforge/shared';
import { DATA_HANDLING_RULES, renderUntrusted, type UntrustedSource } from './untrusted';

// ---------------------------------------------------------------------------------------
// company brief

export const COMPANY_BRIEF_SYSTEM = `You write a short, factual company brief that helps a candidate prepare for an interview.

Rules:
1. Use only facts supported by the provided sources. Cite every source you used by its label (S1, S2, P1, ...) in "cited_sources".
2. "what_they_do": 1–2 sentences on what the company appears to do (products, customers). If the sources do not say, write "The research did not find enough information to describe what the company does."
3. "summary": 3–6 sentences of research-backed information useful in an interview: products and customers, mission or values, engineering practices, team or hiring information. Use cautious wording such as "appears to" or "according to its careers page".
4. Describe an interview process only if a source explicitly describes it. P-labelled sources are third-party public discussion: attribute them (for example "candidates on Hacker News report ...").
5. Never invent numbers, names, dates, products or claims. Do not pad the brief with generic statements.
6. The JD source describes the role; use it only for context about the role, not as evidence about the company unless it states company facts.

${DATA_HANDLING_RULES}

Return JSON exactly in this shape:
{"what_they_do": string, "summary": string, "cited_sources": [string]}`;

export function buildCompanyBriefUser(
  context: UntrustedSource,
  jd: UntrustedSource,
  research: UntrustedSource[],
): string {
  return `${renderUntrusted([context, jd, ...research], { perSourceChars: 2_000, totalChars: 12_000 })}

Write the company brief using only the sources above.`;
}

// ---------------------------------------------------------------------------------------
// questions

const CATEGORY_GUIDANCE: Record<QuestionCategory, string> = {
  technical:
    'Technical questions test the specific skills, tools and practices in the requirements. Prefer realistic scenarios, debugging and trade-off questions over trivia.',
  behavioural:
    'Behavioural questions ask about past experience ("Tell me about a time ...") that demonstrates the requirements. Answer outlines follow STAR (Situation, Task, Action, Result) and say what a strong answer shows.',
  'system-design':
    'System design questions ask the candidate to design a system relevant to this role and company, exercising the technical and domain requirements. Answer outlines cover clarifying requirements, core components, data model, scaling, failure handling and trade-offs.',
  'company-fit':
    'Company-fit questions explore motivation and alignment with THIS company, grounded in the research sources (what it does, mission, values, team, hiring information). Avoid generic questions that would fit any company when research is available, and never state company facts that the sources do not support.',
};

export function questionsSystem(category: QuestionCategory, mode: 'plan' | 'gap_fill'): string {
  const countRule =
    mode === 'plan'
      ? '1. Write exactly the number of questions requested.'
      : "1. Write exactly one question for EACH requirement in the TARGET_REQUIREMENTS source. Each question must reference that requirement's ID.";
  return `You write interview preparation questions in one category: ${category}.
${CATEGORY_GUIDANCE[category]}

Rules:
${countRule}
2. Each question references 1–3 requirement IDs, copied exactly from the REQUIREMENTS source (for example "r2"). Only reference requirements the question genuinely tests.
3. Cover the must-have requirements first: every must-have requirement listed should be referenced by at least one question.
4. "answer_outline": 2–5 short bullet points describing what a strong answer covers, not a full script.
5. "difficulty": 1 (warm-up), 2 (standard) or 3 (hard), appropriate to the seniority.
6. Do not repeat or closely paraphrase anything in the EXISTING_QUESTIONS source.

${DATA_HANDLING_RULES}

Return JSON exactly in this shape:
{"questions": [{"prompt": string, "answer_outline": string, "difficulty": 1 | 2 | 3, "requirement_ids": [string]}]}`;
}

export function requirementsSource(
  label: string,
  requirements: readonly Requirement[],
): UntrustedSource {
  return {
    label,
    type: 'extracted_requirements',
    content: JSON.stringify(
      requirements.map((r) => ({ id: r.id, text: r.text, kind: r.kind, priority: r.priority })),
    ),
  };
}

export function buildQuestionsUser(options: {
  category: QuestionCategory;
  count: number | null;
  role: UntrustedSource;
  requirements: UntrustedSource;
  targets?: UntrustedSource;
  existing: UntrustedSource;
  company?: UntrustedSource;
  research?: UntrustedSource[];
  mustIds: string[];
}): string {
  const sources = [
    options.role,
    options.requirements,
    ...(options.targets ? [options.targets] : []),
    options.existing,
    ...(options.company ? [options.company] : []),
    ...(options.research ?? []),
  ];
  const task =
    options.count !== null
      ? `Write exactly ${options.count} ${options.category} questions.`
      : `Write one ${options.category} question for each requirement in TARGET_REQUIREMENTS.`;
  const must =
    options.mustIds.length > 0
      ? `\nMust-have requirement IDs to cover first: ${options.mustIds.join(', ')}.`
      : '';
  return `${renderUntrusted(sources, { perSourceChars: 8_000, totalChars: 16_000 })}

${task}${must}`;
}

// ---------------------------------------------------------------------------------------
// flashcards

export function flashcardsSystem(mode: 'plan' | 'gap_fill'): string {
  const countRule =
    mode === 'plan'
      ? '1. Write exactly the number of flashcards requested, covering every must-have requirement at least once.'
      : "1. Write exactly one flashcard for EACH requirement in the TARGET_REQUIREMENTS source, referencing that requirement's ID.";
  return `You write study flashcards for an interview candidate.

Rules:
${countRule}
2. "front": a concise question, prompt or term about a requirement or one of the interview questions.
3. "back": a concise, correct answer in 1–4 sentences. Do not invent facts about the company.
4. Each flashcard references 1–2 requirement IDs, copied exactly from the REQUIREMENTS source.
5. No generic flashcards unrelated to the requirements. Do not duplicate anything in EXISTING_FLASHCARDS.

${DATA_HANDLING_RULES}

Return JSON exactly in this shape:
{"flashcards": [{"front": string, "back": string, "requirement_ids": [string]}]}`;
}

export function buildFlashcardsUser(options: {
  count: number | null;
  role: UntrustedSource;
  requirements: UntrustedSource;
  targets?: UntrustedSource;
  questions: UntrustedSource;
  existing: UntrustedSource;
  mustIds: string[];
}): string {
  const sources = [
    options.role,
    options.requirements,
    ...(options.targets ? [options.targets] : []),
    options.questions,
    options.existing,
  ];
  const task =
    options.count !== null
      ? `Write exactly ${options.count} flashcards.`
      : 'Write one flashcard for each requirement in TARGET_REQUIREMENTS.';
  const must =
    options.mustIds.length > 0 ? `\nMust-have requirement IDs: ${options.mustIds.join(', ')}.` : '';
  return `${renderUntrusted(sources, { perSourceChars: 8_000, totalChars: 16_000 })}

${task}${must}`;
}
