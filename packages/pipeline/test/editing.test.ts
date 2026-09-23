import { AppError } from '@prepforge/shared';
import { describe, expect, it } from 'vitest';
import { appendQuestions, replaceGeneratedQuestions } from '../src/editing/merge';
import {
  addFlashcard,
  addQuestion,
  deleteFlashcard,
  deleteQuestion,
  reorderQuestions,
  setDaysAvailable,
  updateCompanyBrief,
  updateFlashcard,
  updateQuestion,
} from '../src/editing/mutations';
import { validateKit } from '../src/validation/validate-kit';
import { toExternalKit } from '../src/editing/project';
import { buildKit, card, question, req } from './support/kits';

const requirements = [req(1), req(2), req(3, 'behavioural'), req(4, 'domain', 'nice')];

function sampleKit() {
  return buildKit({
    requirements,
    questions: [
      question(1, ['r1']),
      question(2, ['r2']),
      question(3, ['r3'], { category: 'behavioural' }),
      question(4, ['r1', 'r2']),
      question(5, ['r4'], { category: 'company-fit' }),
    ],
    flashcards: [card(1, ['r1']), card(2, ['r3'])],
    days: 4,
  });
}

const draft = (n: number, ids: string[]) => ({
  requirement_ids: ids,
  category: 'technical' as const,
  prompt: `New question ${n}?`,
  answer_outline: `New outline ${n}`,
  difficulty: 2 as const,
});

const expectValid = (kit: ReturnType<typeof sampleKit>) =>
  expect(validateKit(toExternalKit(kit)).errors).toEqual([]);

describe('question edits', () => {
  it('marks an edited generated question as edited', () => {
    const { kit, question: q } = updateQuestion(sampleKit(), 'q1', { prompt: 'Better prompt?' });
    expect(q).toMatchObject({ prompt: 'Better prompt?', state: 'edited', origin: 'generated' });
    expectValid(kit);
  });

  it('does not change state when nothing actually changed', () => {
    const { question: q } = updateQuestion(sampleKit(), 'q1', { prompt: 'Question 1?' });
    expect(q.state).toBe('generated');
  });

  it('keeps a pinned question pinned when it is edited, and unpinning keeps it protected', () => {
    const pinned = updateQuestion(sampleKit(), 'q2', { pinned: true });
    expect(pinned.question.state).toBe('pinned');
    const edited = updateQuestion(pinned.kit, 'q2', { answer_outline: 'Sharper outline' });
    expect(edited.question.state).toBe('pinned');
    expect(updateQuestion(edited.kit, 'q2', { pinned: false }).question.state).toBe('edited');
  });

  it('moves a question to another category, placing it at the end of that category', () => {
    const { kit } = updateQuestion(sampleKit(), 'q1', { category: 'behavioural' });
    expect(kit.questions.map((q) => q.id)).toEqual(['q2', 'q3', 'q1', 'q4', 'q5']);
    expect(kit.questions.find((q) => q.id === 'q1')!.state).toBe('edited');
  });

  it('adds a user question with a fresh ID and refreshes coverage', () => {
    const start = buildKit({ requirements, questions: [question(1, ['r1'])], days: 2 });
    expect(start.coverage.uncovered_requirement_ids).toEqual(['r2', 'r3']);
    const { kit, question: added } = addQuestion(start, draft(1, ['r2', 'r3']));
    expect(added).toMatchObject({ id: 'q2', state: 'edited', origin: 'user' });
    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(kit.schedule.days.flatMap((d) => d.question_ids)).toContain('q2');
    expectValid(kit);
  });

  it('never reuses a deleted question ID', () => {
    const afterDelete = deleteQuestion(sampleKit(), 'q5');
    const { question: added } = addQuestion(afterDelete, draft(1, ['r4']));
    expect(added.id).toBe('q6');
  });

  it('recomputes coverage and schedule after a delete', () => {
    const kit = deleteQuestion(sampleKit(), 'q3');
    expect(kit.coverage.uncovered_requirement_ids).toEqual(['r3']);
    expect(kit.schedule.days.flatMap((d) => d.question_ids)).not.toContain('q3');
    expectValid(kit);
  });

  it('rejects unknown requirements, empty prompts and bad difficulty', () => {
    const kit = sampleKit();
    expect(() => addQuestion(kit, draft(1, ['r9']))).toThrow(AppError);
    expect(() => addQuestion(kit, { ...draft(1, ['r1']), prompt: '  ' })).toThrow(/Prompt/);
    expect(() => updateQuestion(kit, 'q1', { difficulty: 4 })).toThrow(/Difficulty/);
    expect(() => updateQuestion(kit, 'q99', { prompt: 'x' })).toThrow(/not found/);
  });
});

describe('reorder', () => {
  it('reorders within one category and leaves other positions alone', () => {
    const kit = reorderQuestions(sampleKit(), 'technical', ['q4', 'q1', 'q2']);
    expect(kit.questions.map((q) => q.id)).toEqual(['q4', 'q1', 'q3', 'q2', 'q5']);
    expectValid(kit);
  });

  it.each([[['q1', 'q2']], [['q1', 'q2', 'q4', 'q3']], [['q1', 'q1', 'q2']]])(
    'rejects %j because it is not an exact permutation',
    (ids) => {
      expect(() => reorderQuestions(sampleKit(), 'technical', ids)).toThrow(/exactly once/);
    },
  );
});

describe('flashcards, brief and days', () => {
  it('adds, edits and deletes flashcards with state tracking', () => {
    const added = addFlashcard(sampleKit(), { front: 'Q', back: 'A', requirement_ids: ['r2'] });
    expect(added.flashcard).toMatchObject({ id: 'f3', origin: 'user', state: 'edited' });
    const edited = updateFlashcard(added.kit, 'f1', { back: 'Better answer' });
    expect(edited.flashcard.state).toBe('edited');
    const deleted = deleteFlashcard(edited.kit, 'f2');
    expect(deleted.flashcards.map((f) => f.id)).toEqual(['f1', 'f3']);
    expectValid(deleted);
  });

  it('marks the brief edited or pinned', () => {
    const edited = updateCompanyBrief(sampleKit(), { summary: 'Hand-written summary.' });
    expect(edited.company_brief.state).toBe('edited');
    expect(updateCompanyBrief(edited, { pinned: true }).company_brief.state).toBe('pinned');
  });

  it('rebuilds the schedule for a new number of days', () => {
    const kit = setDaysAvailable(sampleKit(), 9);
    expect(kit.schedule.days).toHaveLength(9);
    expectValid(kit);
    expect(() => setDaysAvailable(kit, 0)).toThrow(AppError);
  });
});

describe('regeneration merge', () => {
  function editedKit() {
    let kit = sampleKit();
    kit = updateQuestion(kit, 'q2', { prompt: 'My own wording?' }).kit; // edited
    kit = updateQuestion(kit, 'q4', { pinned: true }).kit; // pinned
    kit = addQuestion(kit, draft(9, ['r1'])).kit; // user-created → q6
    return kit;
  }

  it('replaces generated questions but keeps edited, pinned and user-created ones', () => {
    const before = editedKit();
    const { kit, removedIds, added } = replaceGeneratedQuestions(before, 'technical', [
      { ...draft(1, ['r1']), category: 'technical' },
      { ...draft(2, ['r2']), category: 'technical' },
    ]);
    expect(removedIds).toEqual(['q1']);
    expect(added.map((q) => q.id)).toEqual(['q7', 'q8']);
    const ids = kit.questions.map((q) => q.id);
    expect(ids).toEqual(expect.arrayContaining(['q2', 'q4', 'q6']));
    expect(ids).not.toContain('q1');
    expect(kit.questions.find((q) => q.id === 'q2')!.prompt).toBe('My own wording?');
    // q7 takes q1's position; q8 follows the last technical question
    expect(ids).toEqual(['q7', 'q2', 'q3', 'q4', 'q6', 'q8', 'q5']);
  });

  it('leaves every other category byte-for-byte unchanged', () => {
    const before = editedKit();
    const { kit } = replaceGeneratedQuestions(before, 'technical', [draft(1, ['r1'])]);
    const others = (k: typeof before) => k.questions.filter((q) => q.category !== 'technical');
    expect(others(kit)).toEqual(others(before));
    expect(kit.flashcards).toEqual(before.flashcards);
    expect(kit.company_brief).toEqual(before.company_brief);
    expect(kit.role).toEqual(before.role);
  });

  it('appends gap-fill questions next to their category with fresh IDs', () => {
    const { kit, added } = appendQuestions(
      sampleKit(),
      [{ ...draft(1, ['r3']), category: 'behavioural' }],
      'gap_fill',
    );
    expect(added[0]).toMatchObject({ id: 'q6', origin: 'gap_fill', state: 'generated' });
    expect(kit.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3', 'q6', 'q4', 'q5']);
  });
});
