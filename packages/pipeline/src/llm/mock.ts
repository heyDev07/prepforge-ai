/** Deterministic LLM for tests: scripted responses per task, with every call recorded. */
import type { LlmProvider, LlmRequest, LlmResponse } from './provider';

type MockReply = string | LlmResponse | Error;
export type MockResponder = (
  request: LlmRequest,
  callIndex: number,
) => MockReply | Promise<MockReply>;
/** Per task: a fixed reply, a sequence (the last entry repeats) or a function. */
export type MockScript = Record<string, MockReply | MockReply[] | MockResponder>;

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock';
  readonly calls: LlmRequest[] = [];
  private readonly counts = new Map<string, number>();

  constructor(private readonly script: MockScript | MockResponder) {}

  callsFor(task: string): LlmRequest[] {
    return this.calls.filter((call) => call.task === task);
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    const index = this.counts.get(request.task) ?? 0;
    this.counts.set(request.task, index + 1);

    let reply: MockReply;
    if (typeof this.script === 'function') {
      reply = await this.script(request, index);
    } else {
      const entry = this.script[request.task];
      if (entry === undefined) {
        throw new Error(`MockLlmProvider has no scripted reply for task "${request.task}"`);
      }
      if (typeof entry === 'function') reply = await entry(request, index);
      else if (Array.isArray(entry)) reply = entry[Math.min(index, entry.length - 1)]!;
      else reply = entry;
    }

    if (reply instanceof Error) throw reply;
    return typeof reply === 'string' ? { text: reply, finishReason: 'stop' } : reply;
  }
}
