'use client';

import type { InternalFlashcard } from '@prepforge/shared';
import { Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Textarea } from '@/components/ui';
import { api, type FlashcardInput } from '@/lib/api';
import { useKitMutation } from '@/lib/queries';
import { useBuilder, useRequirementMap } from './context';
import { RequirementPicker } from './requirement-picker';

function FlashcardForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: FlashcardInput;
  submitLabel: string;
  pending: boolean;
  onSubmit: (value: FlashcardInput) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const labelId = useId();
  const valid = value.front.trim() && value.back.trim() && value.requirement_ids.length > 0;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) onSubmit({ ...value, front: value.front.trim(), back: value.back.trim() });
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Front">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            autoFocus
            value={value.front}
            onChange={(e) => setValue({ ...value, front: e.target.value })}
          />
        )}
      </Field>
      <Field label="Back">
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            value={value.back}
            onChange={(e) => setValue({ ...value, back: e.target.value })}
          />
        )}
      </Field>
      <div className="space-y-1.5">
        <p id={labelId} className="text-sm font-medium text-slate-800">
          Requirements
        </p>
        <RequirementPicker
          labelId={labelId}
          value={value.requirement_ids}
          onChange={(ids) => setValue({ ...value, requirement_ids: ids })}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending} disabled={!valid}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function FlashcardsTab() {
  const { id, kit, detail, busy } = useBuilder();
  const requirements = useRequirementMap();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<InternalFlashcard | null>(null);

  const add = useKitMutation(
    id,
    (input: FlashcardInput) => api.addFlashcard(id, { ...input, revision: detail.revision }),
    {
      success: 'Flashcard added.',
      onSuccess: () => setAdding(false),
    },
  );
  const update = useKitMutation(
    id,
    ({ cardId, patch }: { cardId: string; patch: Parameters<typeof api.updateFlashcard>[2] }) =>
      api.updateFlashcard(id, cardId, { ...patch, revision: detail.revision }),
    { onSuccess: () => setEditingId(null) },
  );
  const remove = useKitMutation(
    id,
    (cardId: string) => api.deleteFlashcard(id, cardId, detail.revision),
    {
      success: 'Flashcard deleted.',
      onSettled: () => setDeleting(null),
    },
  );

  // pinned cards first; otherwise keep the kit's order (sort is stable)
  const cards = [...kit.flashcards].sort(
    (a, b) => Number(b.state === 'pinned') - Number(a.state === 'pinned'),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {kit.flashcards.length} flashcards, built from the requirements and questions.
        </p>
        <Button
          size="sm"
          disabled={busy}
          icon={<Plus className="size-4" aria-hidden />}
          onClick={() => setAdding(true)}
        >
          Add flashcard
        </Button>
      </div>

      {adding ? (
        <Card className="p-5">
          <FlashcardForm
            initial={{ front: '', back: '', requirement_ids: [] }}
            submitLabel="Add flashcard"
            pending={add.isPending}
            onSubmit={(value) => add.mutate(value)}
            onCancel={() => setAdding(false)}
          />
        </Card>
      ) : null}

      {kit.flashcards.length === 0 ? (
        <EmptyState title="No flashcards yet" description="Add a flashcard to start practising." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {cards.map((card) => (
            <li key={card.id}>
              <Card className="flex h-full flex-col p-4">
                {editingId === card.id ? (
                  <FlashcardForm
                    initial={{
                      front: card.front,
                      back: card.back,
                      requirement_ids: card.requirement_ids,
                    }}
                    submitLabel="Save flashcard"
                    pending={update.isPending}
                    onSubmit={(value) => update.mutate({ cardId: card.id, patch: value })}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <p className="text-sm font-medium text-slate-900">{card.front}</p>
                    <p className="mt-2 flex-1 text-sm whitespace-pre-line text-slate-600">
                      {card.back}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {card.state !== 'generated' ? (
                        <Badge tone={card.state === 'pinned' ? 'violet' : 'brand'}>
                          {card.state === 'pinned' ? 'Pinned' : 'Edited'}
                        </Badge>
                      ) : null}
                      {card.requirement_ids.map((rid) => (
                        <Badge key={rid} title={requirements.get(rid)?.text}>
                          <span className="font-mono">{rid}</span>
                        </Badge>
                      ))}
                      <div className="ml-auto flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label="Edit flashcard"
                          onClick={() => setEditingId(card.id)}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label={card.state === 'pinned' ? 'Unpin flashcard' : 'Pin flashcard'}
                          aria-pressed={card.state === 'pinned'}
                          onClick={() =>
                            update.mutate({
                              cardId: card.id,
                              patch: { pinned: card.state !== 'pinned' },
                            })
                          }
                        >
                          {card.state === 'pinned' ? (
                            <PinOff className="size-4" aria-hidden />
                          ) : (
                            <Pin className="size-4" aria-hidden />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label="Delete flashcard"
                          onClick={() => setDeleting(card)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this flashcard?"
        description={deleting?.front}
        confirmLabel="Delete"
        tone="danger"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
