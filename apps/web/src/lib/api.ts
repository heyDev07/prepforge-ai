/**
 * Typed client for the PrepForge API. Requests go to this app's own origin (/api/*), which
 * Next.js proxies to the API server, so the HttpOnly session cookie is sent automatically.
 */
import type {
  CardStats,
  GenerationJob,
  InternalFlashcard,
  InternalQuestion,
  KitDetailDto,
  KitSummaryDto,
  PracticeNextDto,
  QuestionCategory,
  StructuredError,
  UserDto,
  WeakSpotsReport,
} from '@prepforge/shared';

export class ApiError extends Error {
  readonly code: StructuredError['code'];
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(error: StructuredError & { details?: Record<string, unknown> }, status: number) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.status = status;
    this.retryable = error.retryable;
    this.details = error.details;
  }

  /** Field-level validation messages, keyed by field path. */
  get fieldErrors(): Record<string, string> {
    const fields = (this.details?.fields ?? []) as { path: string; message: string }[];
    return Object.fromEntries(fields.map((f) => [f.path, f.message]));
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      {
        code: 'INTERNAL_ERROR',
        message: 'Could not reach the server. Check your connection.',
        retryable: true,
      },
      0,
    );
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      data?.error ?? {
        code: 'INTERNAL_ERROR',
        message: `The request failed (HTTP ${response.status}).`,
        retryable: response.status >= 500,
      },
      response.status,
    );
  }
  return data as T;
}

export interface KitResponse {
  kit: KitDetailDto;
}

export interface QuestionInput {
  category: QuestionCategory;
  prompt: string;
  answer_outline: string;
  difficulty: 1 | 2 | 3;
  requirement_ids: string[];
}

export interface FlashcardInput {
  front: string;
  back: string;
  requirement_ids: string[];
}

export const api = {
  // auth
  me: () => request<{ user: UserDto }>('/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: UserDto }>('/auth/login', 'POST', { email, password }),
  register: (email: string, password: string) =>
    request<{ user: UserDto }>('/auth/register', 'POST', { email, password }),
  logout: () => request<void>('/auth/logout', 'POST'),

  // kits
  listKits: () => request<{ kits: KitSummaryDto[] }>('/kits'),
  getKit: (id: string) => request<KitResponse>(`/kits/${id}`),
  createKit: (input: {
    jd: string;
    company_url: string;
    days: number;
    allow_duplicate?: boolean;
  }) => request<KitResponse>('/kits', 'POST', input),
  updateKit: (
    id: string,
    patch: {
      company_brief?: { summary?: string; what_they_do?: string; pinned?: boolean };
      days_available?: number;
      revision?: number;
    },
  ) => request<KitResponse>(`/kits/${id}`, 'PATCH', patch),
  deleteKit: (id: string) => request<void>(`/kits/${id}`, 'DELETE'),
  exportUrl: (id: string) => `/api/kits/${id}/export`,

  // generation
  generate: (id: string) => request<{ job: GenerationJob }>(`/kits/${id}/generate`, 'POST'),
  generationStatus: (id: string) =>
    request<{ kit_status: KitDetailDto['status']; job: GenerationJob | null }>(
      `/kits/${id}/generation-status`,
    ),
  regenerateCompany: (id: string, force = false) =>
    request<{ job: GenerationJob }>(`/kits/${id}/regenerate/company`, 'POST', { force }),
  regenerateQuestions: (id: string, category: QuestionCategory) =>
    request<{ job: GenerationJob }>(`/kits/${id}/regenerate/questions/${category}`, 'POST'),
  regenerateSchedule: (id: string, revision?: number) =>
    request<KitResponse>(`/kits/${id}/regenerate/schedule`, 'POST', { revision }),

  // questions
  addQuestion: (id: string, input: QuestionInput & { revision?: number }) =>
    request<KitResponse & { question: InternalQuestion }>(`/kits/${id}/questions`, 'POST', input),
  updateQuestion: (
    id: string,
    questionId: string,
    patch: Partial<QuestionInput> & { pinned?: boolean; revision?: number },
  ) =>
    request<KitResponse & { question: InternalQuestion }>(
      `/kits/${id}/questions/${questionId}`,
      'PATCH',
      patch,
    ),
  deleteQuestion: (id: string, questionId: string, revision?: number) =>
    request<KitResponse>(`/kits/${id}/questions/${questionId}`, 'DELETE', { revision }),
  reorderQuestions: (
    id: string,
    category: QuestionCategory,
    orderedIds: string[],
    revision?: number,
  ) =>
    request<KitResponse>(`/kits/${id}/questions/reorder`, 'POST', {
      category,
      ordered_ids: orderedIds,
      revision,
    }),

  // flashcards
  addFlashcard: (id: string, input: FlashcardInput & { revision?: number }) =>
    request<KitResponse & { flashcard: InternalFlashcard }>(
      `/kits/${id}/flashcards`,
      'POST',
      input,
    ),
  updateFlashcard: (
    id: string,
    flashcardId: string,
    patch: Partial<FlashcardInput> & { pinned?: boolean; revision?: number },
  ) =>
    request<KitResponse & { flashcard: InternalFlashcard }>(
      `/kits/${id}/flashcards/${flashcardId}`,
      'PATCH',
      patch,
    ),
  deleteFlashcard: (id: string, flashcardId: string, revision?: number) =>
    request<KitResponse>(`/kits/${id}/flashcards/${flashcardId}`, 'DELETE', { revision }),

  // practice
  recordPractice: (id: string, flashcardId: string, confidence: number) =>
    request<{ stats: CardStats }>(`/kits/${id}/practice/${flashcardId}`, 'POST', { confidence }),
  practiceNext: (id: string, mode: 'all' | 'weak', answered: readonly string[], last?: string) => {
    const params = new URLSearchParams({ mode });
    if (answered.length > 0) params.set('answered', answered.join(','));
    if (last) params.set('last', last);
    return request<PracticeNextDto>(`/kits/${id}/practice/next?${params}`);
  },
  weakSpots: (id: string) => request<{ weak_spots: WeakSpotsReport }>(`/kits/${id}/weak-spots`),
};
