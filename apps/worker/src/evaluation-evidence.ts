import { AsyncLocalStorage } from "node:async_hooks";

import type { RuntimeEventId } from "@sisyphus/domain";

export interface DeterministicCommandEvidence {
  readonly kind: "deterministic-command";
  readonly eventId: RuntimeEventId;
  readonly checkId: string;
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
  readonly timeoutMilliseconds: number;
  readonly outcome: {
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly timedOut: boolean;
    readonly startError?: string;
    readonly output: string;
    readonly outputTruncated: boolean;
  };
}

export type LocalEvaluationEvidence = DeterministicCommandEvidence;

interface EvidenceCollection<T> {
  readonly result: T;
  readonly evidence: readonly LocalEvaluationEvidence[];
}

export class EvaluationEvidenceCollector {
  readonly #storage = new AsyncLocalStorage<LocalEvaluationEvidence[]>();

  public async collect<T>(
    operation: () => Promise<T>,
  ): Promise<EvidenceCollection<T>> {
    if (this.#storage.getStore() !== undefined) {
      throw new Error("Evaluation evidence collection cannot be nested.");
    }
    const evidence: LocalEvaluationEvidence[] = [];
    const result = await this.#storage.run(evidence, operation);
    return { result, evidence };
  }

  public capture(evidence: LocalEvaluationEvidence): void {
    const active = this.#storage.getStore();
    if (active === undefined) {
      throw new Error("Command evidence requires an active supervision collection.");
    }
    active.push(evidence);
  }
}
