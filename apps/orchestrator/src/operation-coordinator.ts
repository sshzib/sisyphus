import {
  EngineeringEventSummarySchema,
  EngineeringOperationSummarySchema,
  type EngineeringEventSummary,
  type EngineeringOperationSummary,
} from "@sisyphus/ui/contracts";

export class TaskOperationCoordinator {
  #operation: EngineeringOperationSummary;
  #tail: Promise<void> = Promise.resolve();

  public constructor(input: {
    readonly initial: EngineeringOperationSummary;
    readonly publish: (
      operation: EngineeringOperationSummary,
      events: readonly EngineeringEventSummary[],
    ) => Promise<void>;
  }) {
    this.#operation = EngineeringOperationSummarySchema.parse(input.initial);
    this.#publish = input.publish;
  }

  readonly #publish: (
    operation: EngineeringOperationSummary,
    events: readonly EngineeringEventSummary[],
  ) => Promise<void>;

  public current(): EngineeringOperationSummary {
    return this.#operation;
  }

  public async transition(input: {
    readonly reduce: (current: EngineeringOperationSummary) => EngineeringOperationSummary;
    readonly events:
      | readonly EngineeringEventSummary[]
      | ((next: EngineeringOperationSummary) => readonly EngineeringEventSummary[]);
  }): Promise<EngineeringOperationSummary> {
    const job = this.#tail.then(async () => {
      const next = EngineeringOperationSummarySchema.parse(input.reduce(this.#operation));
      const events = typeof input.events === "function" ? input.events(next) : input.events;
      const parsedEvents = events.map((event) => EngineeringEventSummarySchema.parse(event));
      await this.#publish(next, parsedEvents);
      this.#operation = next;
      return next;
    });
    this.#tail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }
}
