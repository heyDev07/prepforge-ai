'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  QUESTION_CATEGORIES,
  type InternalQuestion,
  type QuestionCategory,
} from '@prepforge/shared';
import {
  GripVertical,
  MessageSquarePlus,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, cx, EmptyState } from '@/components/ui';
import { api, type QuestionInput } from '@/lib/api';
import { CATEGORY_LABELS, DIFFICULTY_LABELS } from '@/lib/labels';
import { useKitMutation, useStartJob } from '@/lib/queries';
import { useBuilder, useRequirementMap } from './context';
import { QuestionForm } from './question-form';
import { Tabs } from './tabs';

const STATE_BADGE = {
  edited: { label: 'Edited', tone: 'brand' },
  pinned: { label: 'Pinned', tone: 'violet' },
} as const;

export function QuestionsTab() {
  const { id, kit, detail, busy } = useBuilder();
  const [category, setCategory] = useState<QuestionCategory>('technical');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<InternalQuestion | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);

  const inCategory = useMemo(
    () => kit.questions.filter((q) => q.category === category),
    [kit.questions, category],
  );
  const ordered = dragOrder
    ? dragOrder
        .map((qid) => inCategory.find((q) => q.id === qid))
        .filter((q): q is InternalQuestion => Boolean(q))
    : inCategory;

  const add = useKitMutation(
    id,
    (input: QuestionInput) => api.addQuestion(id, { ...input, revision: detail.revision }),
    {
      success: 'Question added.',
      onSuccess: () => setAdding(false),
    },
  );
  const update = useKitMutation(
    id,
    ({
      questionId,
      patch,
    }: {
      questionId: string;
      patch: Parameters<typeof api.updateQuestion>[2];
    }) => api.updateQuestion(id, questionId, { ...patch, revision: detail.revision }),
    { onSuccess: () => setEditingId(null) },
  );
  const remove = useKitMutation(
    id,
    (questionId: string) => api.deleteQuestion(id, questionId, detail.revision),
    {
      success: 'Question deleted.',
      onSettled: () => setDeleting(null),
    },
  );
  const reorder = useKitMutation(
    id,
    (orderedIds: string[]) => api.reorderQuestions(id, category, orderedIds, detail.revision),
    { onSettled: () => setDragOrder(null) },
  );
  const regenerate = useStartJob(
    id,
    (c: QuestionCategory) => api.regenerateQuestions(id, c),
    `Regenerating ${CATEGORY_LABELS[category].toLowerCase()} questions…`,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = ordered.map((q) => q.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setDragOrder(next); // optimistic; reverted if the save fails
    reorder.mutate(next);
  }

  const counts = Object.fromEntries(
    QUESTION_CATEGORIES.map((c) => [c, kit.questions.filter((q) => q.category === c).length]),
  ) as Record<QuestionCategory, number>;
  const preserved = inCategory.filter((q) => q.state !== 'generated').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          size="sm"
          idPrefix="question-category"
          label="Question categories"
          value={category}
          onChange={(c) => {
            setCategory(c);
            setAdding(false);
            setEditingId(null);
          }}
          items={QUESTION_CATEGORIES.map((c) => ({
            id: c,
            label: (
              <>
                {CATEGORY_LABELS[c]} <span className="ml-1 opacity-70">{counts[c]}</span>
              </>
            ),
          }))}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy}
            icon={<MessageSquarePlus className="size-4" aria-hidden />}
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
          >
            Add question
          </Button>
          <Button
            size="sm"
            disabled={busy}
            loading={regenerate.isPending}
            icon={<RefreshCw className="size-4" aria-hidden />}
            onClick={() => setConfirmRegenerate(true)}
          >
            Regenerate
          </Button>
        </div>
      </div>

      {adding ? (
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">
            New {CATEGORY_LABELS[category].toLowerCase()} question
          </h3>
          <QuestionForm
            initial={{
              category,
              prompt: '',
              answer_outline: '',
              difficulty: 2,
              requirement_ids: [],
            }}
            submitLabel="Add question"
            pending={add.isPending}
            onSubmit={(value) => add.mutate(value)}
            onCancel={() => setAdding(false)}
          />
        </Card>
      ) : null}

      <div
        role="tabpanel"
        id={`question-category-panel-${category}`}
        aria-labelledby={`question-category-tab-${category}`}
      >
        {ordered.length === 0 ? (
          <EmptyState
            title={`No ${CATEGORY_LABELS[category].toLowerCase()} questions`}
            description="Add your own, or regenerate this category."
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={ordered.map((q) => q.id)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="space-y-3" aria-label={`${CATEGORY_LABELS[category]} questions`}>
                {ordered.map((question, index) => (
                  <SortableQuestion
                    key={question.id}
                    question={question}
                    index={index}
                    disabled={busy || reorder.isPending}
                    editing={editingId === question.id}
                    pending={update.isPending}
                    onEdit={() => {
                      setEditingId(question.id);
                      setAdding(false);
                    }}
                    onCancelEdit={() => setEditingId(null)}
                    onSave={(value) => update.mutate({ questionId: question.id, patch: value })}
                    onTogglePin={() =>
                      update.mutate({
                        questionId: question.id,
                        patch: { pinned: question.state !== 'pinned' },
                      })
                    }
                    onDelete={() => setDeleting(question)}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Drag the handle to reorder, or focus it and use Space and the arrow keys.
        </p>
      </div>

      <ConfirmDialog
        open={confirmRegenerate}
        title={`Regenerate ${CATEGORY_LABELS[category].toLowerCase()} questions?`}
        description={
          <>
            Generated questions in this category will be replaced.{' '}
            {preserved > 0
              ? `Your ${preserved} edited, pinned or added question(s) will be kept.`
              : 'Edit or pin a question first if you want to keep it.'}{' '}
            Other categories, flashcards and the company brief are not touched.
          </>
        }
        confirmLabel="Regenerate"
        loading={regenerate.isPending}
        onCancel={() => setConfirmRegenerate(false)}
        onConfirm={() =>
          regenerate.mutate(category, { onSettled: () => setConfirmRegenerate(false) })
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this question?"
        description={deleting?.prompt}
        confirmLabel="Delete"
        tone="danger"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function SortableQuestion({
  question,
  index,
  disabled,
  editing,
  pending,
  onEdit,
  onCancelEdit,
  onSave,
  onTogglePin,
  onDelete,
}: {
  question: InternalQuestion;
  index: number;
  disabled: boolean;
  editing: boolean;
  pending: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (value: QuestionInput) => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const requirements = useRequirementMap();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: question.id,
    disabled: disabled || editing,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const stateBadge = question.state === 'generated' ? null : STATE_BADGE[question.state];

  return (
    <li ref={setNodeRef} style={style} className={cx(isDragging && 'relative z-10')}>
      <Card className={cx('p-4', isDragging && 'shadow-lg ring-brand-300')}>
        {editing ? (
          <QuestionForm
            initial={{
              category: question.category,
              prompt: question.prompt,
              answer_outline: question.answer_outline,
              difficulty: question.difficulty as 1 | 2 | 3,
              requirement_ids: question.requirement_ids,
            }}
            submitLabel="Save question"
            pending={pending}
            onSubmit={onSave}
            onCancel={onCancelEdit}
          />
        ) : (
          <div className="flex gap-3">
            <button
              ref={setActivatorNodeRef}
              type="button"
              className="mt-0.5 h-fit cursor-grab touch-none rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={`Reorder question ${index + 1}`}
              disabled={disabled}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" aria-hidden />
            </button>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium text-slate-900">
                <span className="mr-1.5 text-slate-400">{index + 1}.</span>
                {question.prompt}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge
                  tone={
                    question.difficulty === 3
                      ? 'red'
                      : question.difficulty === 2
                        ? 'amber'
                        : 'green'
                  }
                >
                  {DIFFICULTY_LABELS[question.difficulty]}
                </Badge>
                {stateBadge ? <Badge tone={stateBadge.tone}>{stateBadge.label}</Badge> : null}
                {question.origin === 'user' ? <Badge tone="brand">Yours</Badge> : null}
                {question.origin === 'gap_fill' ? (
                  <Badge tone="blue" title="Added in the coverage second pass">
                    Coverage fill
                  </Badge>
                ) : null}
                {question.requirement_ids.map((rid) => (
                  <Badge key={rid} title={requirements.get(rid)?.text}>
                    <span className="font-mono">{rid}</span>
                    <span className="max-w-40 truncate">{requirements.get(rid)?.text}</span>
                  </Badge>
                ))}
              </div>
              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-brand-700 select-none hover:underline">
                  Answer outline
                </summary>
                <p className="mt-2 text-sm whitespace-pre-line text-slate-700">
                  {question.answer_outline}
                </p>
              </details>
            </div>
            <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={onEdit}
                aria-label="Edit question"
              >
                <Pencil className="size-4" aria-hidden />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={onTogglePin}
                aria-label={question.state === 'pinned' ? 'Unpin question' : 'Pin question'}
                aria-pressed={question.state === 'pinned'}
              >
                {question.state === 'pinned' ? (
                  <PinOff className="size-4" aria-hidden />
                ) : (
                  <Pin className="size-4" aria-hidden />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={onDelete}
                aria-label="Delete question"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </li>
  );
}
