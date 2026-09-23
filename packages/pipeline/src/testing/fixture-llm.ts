/**
 * A deterministic, offline stand-in for a real model (LLM_PROVIDER=mock). It reads the same
 * prompts the real model receives (the labelled untrusted blocks) and produces plausible,
 * schema-conforming replies from them, so the whole pipeline — and the batch evaluator — can
 * be exercised end to end without network access or API keys.
 *
 * It is intentionally simple; the real product uses a real model.
 */
import type { MockResponder } from '../llm/mock';
import type { LlmRequest } from '../llm/provider';

interface Req {
  id: string;
  text: string;
  kind: string;
  priority: string;
}

export function readSource(user: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `<<<UNTRUSTED_SOURCE label="${escaped}"[^\\n]*>>>\\n([\\s\\S]*?)\\n<<<END_UNTRUSTED_SOURCE label="${escaped}">>>`,
  ).exec(user);
  return match?.[1] ?? null;
}

function readRequirements(user: string, label: string): Req[] {
  const raw = readSource(user, label);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Req[];
  } catch {
    return [];
  }
}

function sourceLabels(user: string): string[] {
  return [...user.matchAll(/<<<UNTRUSTED_SOURCE label="([SP]\d+)"/g)].map((m) => m[1]!);
}

const firstSentence = (text: string) =>
  (
    text
      .replace(/\s+/g, ' ')
      .trim()
      .match(/^.*?[.!?](\s|$)/)?.[0] ?? text.slice(0, 160)
  ).trim();

// ---------------------------------------------------------------------------------------
// extraction

const DOMAIN =
  /(logistic|healthcare|health|payment|freight|supply chain|customs|regulat|robotic|warehouse|industry|trade doc|clinic)/i;
const BEHAVIOURAL =
  /(communicat|mentor|collaborat|feedback|coach|conflict|stakeholder|explain|managing|leading|lead,|performance review|team)/i;
const NICE = /(nice to have|bonus|preferred|a plus|plus if)/i;
const REQ_HEADING =
  /(requirement|you have|looking for|qualification|skills|nice to have|bonus|preferred|must)/i;
const RESP_HEADING = /(what you will do|responsibilit|in this role|you will)/i;

function kindOf(text: string): string {
  if (DOMAIN.test(text)) return 'domain';
  if (BEHAVIOURAL.test(text)) return 'behavioural';
  return 'technical';
}

function extract(jd: string) {
  const lines = jd.split('\n').map((l) => l.trim());
  const first = lines.find(Boolean) ?? 'Role';
  const hiring = /hiring an? ([^.]+)\./i.exec(jd)?.[1];
  const title = (hiring ?? first.split(/\s+[—–-]\s+|,|\(| at /)[0] ?? first).trim();
  const seniority = /\b(senior|junior|staff|principal|lead)\b/i.exec(first)?.[1] ?? null;

  const requirements: object[] = [];
  const responsibilities: string[] = [];
  let section: 'req' | 'resp' | 'other' = 'other';
  let niceSection = false;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (!bullet && !/[.!?]$/.test(line) && (line.endsWith(':') || line.split(/\s+/).length <= 6)) {
      section = REQ_HEADING.test(line) ? 'req' : RESP_HEADING.test(line) ? 'resp' : 'other';
      niceSection = NICE.test(line);
      continue;
    }
    const text = bullet?.[1] ?? line;
    const isRequirementSentence =
      !bullet && /\b(know|experience with|a plus|must have|proficien)/i.test(line);
    if ((bullet && section === 'req') || (isRequirementSentence && section !== 'resp')) {
      const clean = text.replace(/\.$/, '');
      requirements.push({
        text: clean,
        kind: kindOf(clean),
        priority: niceSection || NICE.test(line) ? 'nice' : 'must',
        source_quote: text,
      });
    } else if (bullet && section === 'resp') {
      responsibilities.push(text);
    }
  }
  return {
    company_name: null,
    role_title: title,
    seniority,
    location: null,
    responsibilities,
    requirements,
  };
}

// ---------------------------------------------------------------------------------------
// generation

const TEMPLATES: Record<string, ((text: string) => [string, string])[]> = {
  technical: [
    (t) => [
      `Walk me through how you have applied this in production: ${t}.`,
      '- Concrete project and context\n- Technical decisions and trade-offs\n- Measurable outcome',
    ],
    (t) => [
      `What would you check first when something related to "${t}" fails in production?`,
      '- Symptoms and hypotheses\n- Tools and metrics used\n- Fix and prevention',
    ],
  ],
  behavioural: [
    (t) => [
      `Tell me about a time you demonstrated this: ${t}.`,
      '- Situation and task\n- Your specific actions\n- Result and what you learned',
    ],
    (t) => [
      `Describe a situation where "${t}" was difficult. How did you handle it?`,
      '- The challenge\n- How you approached people involved\n- Outcome',
    ],
  ],
  'system-design': [
    (t) => [
      `Design a system for this company that depends on: ${t}. How would it scale?`,
      '- Clarify requirements\n- Core components and data model\n- Scaling, failure handling and trade-offs',
    ],
  ],
  'company-fit': [
    (t) => [
      `Why does this company's work appeal to you, and how does your experience with "${t}" fit it?`,
      '- What you know about the company (from research)\n- Relevant experience\n- What you want to learn',
    ],
  ],
};

function questions(category: string, targets: Req[], count: number) {
  const templates = TEMPLATES[category] ?? TEMPLATES.technical!;
  const ordered = [
    ...targets.filter((r) => r.priority === 'must'),
    ...targets.filter((r) => r.priority !== 'must'),
  ];
  return Array.from({ length: count }, (_, i) => {
    const req = ordered[i % ordered.length]!;
    const round = Math.floor(i / ordered.length);
    const [prompt, outline] = templates[round % templates.length]!(req.text);
    return {
      prompt: round >= templates.length ? `${prompt} (variation ${round + 1})` : prompt,
      answer_outline: outline,
      difficulty: (i % 3) + 1,
      requirement_ids: [req.id],
    };
  });
}

function flashcards(targets: Req[], count: number) {
  return Array.from({ length: count }, (_, i) => {
    const req = targets[i % targets.length]!;
    const round = Math.floor(i / targets.length);
    return {
      front:
        round === 0
          ? `What does "${req.text}" mean for this role?`
          : `Give an example of: ${req.text} (${round + 1})`,
      back: `Explain ${req.text.toLowerCase()} with one concrete example from your experience.`,
      requirement_ids: [req.id],
    };
  });
}

function reply(request: LlmRequest): string {
  const task = request.task.replace(/:retry$/, '');
  const count = Number(/Write exactly (\d+)/.exec(request.user)?.[1] ?? 0);

  if (task === 'extract_requirements') {
    return JSON.stringify(extract(readSource(request.user, 'JD') ?? ''));
  }
  if (task === 'company_brief') {
    const labels = sourceLabels(request.user);
    const pages = labels.filter((l) => l.startsWith('S'));
    const first = pages[0] ? readSource(request.user, pages[0]) : null;
    const texts = pages.slice(0, 3).map((l) => firstSentence(readSource(request.user, l) ?? ''));
    return JSON.stringify({
      what_they_do: first
        ? `Based on its website, ${firstSentence(first)}`
        : 'The research did not find enough information to describe what the company does.',
      summary: texts.length > 0 ? texts.join(' ') : 'No company pages were available to summarise.',
      cited_sources: labels,
    });
  }
  if (task.startsWith('questions:')) {
    const category = task.split(':')[1]!;
    return JSON.stringify({
      questions: questions(category, readRequirements(request.user, 'REQUIREMENTS'), count),
    });
  }
  if (task.startsWith('questions_gap_fill:')) {
    const category = task.split(':')[1]!;
    const targets = readRequirements(request.user, 'TARGET_REQUIREMENTS');
    return JSON.stringify({ questions: questions(category, targets, targets.length) });
  }
  if (task === 'flashcards') {
    return JSON.stringify({
      flashcards: flashcards(readRequirements(request.user, 'REQUIREMENTS'), count),
    });
  }
  if (task === 'flashcards_gap_fill') {
    const targets = readRequirements(request.user, 'TARGET_REQUIREMENTS');
    return JSON.stringify({ flashcards: flashcards(targets, targets.length) });
  }
  throw new Error(`Fixture LLM does not know task "${request.task}"`);
}

export const fixtureLlmResponder: MockResponder = (request) => reply(request);
