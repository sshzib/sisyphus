import { z } from "zod";

import type { LocalJournal } from "./journal.js";
import { controlPlaneEndpoint } from "./control-plane-endpoint.js";

interface OutboxSynchronizerInput {
  readonly endpoint: string;
  readonly deviceToken: string;
  readonly journal: LocalJournal;
  readonly fetchImplementation?: typeof fetch;
}

const batchResponseSchema = z.object({
  acceptedIds: z.array(z.string().min(1)),
});

export class OutboxSynchronizer {
  readonly #endpoint: URL;
  readonly #deviceToken: string;
  readonly #journal: LocalJournal;
  readonly #fetch: typeof fetch;

  constructor(input: OutboxSynchronizerInput) {
    this.#endpoint = controlPlaneEndpoint({
      baseUrl: input.endpoint,
      pathname: "/v1/events/batch",
      purpose: "Outbox control plane",
    });
    if (input.deviceToken.trim() === "") throw new Error("A device token is required for sync.");
    this.#deviceToken = input.deviceToken;
    this.#journal = input.journal;
    this.#fetch = input.fetchImplementation ?? fetch;
  }

  async flush(): Promise<number> {
    let acknowledgedTotal = 0;
    while (true) {
      const records = this.#journal.pendingOutbox(100);
      if (records.length === 0) return acknowledgedTotal;
      const uploadRecords = records.map(({ id, eventId, payload }) => ({
        id,
        eventId,
        payload,
      }));

      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#deviceToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ records: uploadRecords }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Control plane rejected outbox batch with HTTP ${response.status}.`);
      }
      const parsed = batchResponseSchema.parse(await response.json());
      const pendingIds = new Set(records.map((record) => record.id));
      const acceptedIds = new Set(
        parsed.acceptedIds.filter((id) => pendingIds.has(id)),
      );
      for (const id of acceptedIds) this.#journal.acknowledge(id);
      acknowledgedTotal += acceptedIds.size;
      if (acceptedIds.size === 0) return acknowledgedTotal;
    }
  }
}
