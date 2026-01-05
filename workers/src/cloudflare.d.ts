type DurableObjectState = {
  storage: DurableObjectStorage;
};

type DurableObjectStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
};

type DurableObjectId = {
  toString(): string;
};

type DurableObjectStub = {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
};

type DurableObjectNamespace = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
};

interface Response {
  webSocket?: WebSocket;
}

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

type ExportedHandler<E = unknown> = {
  fetch(request: Request, env: E, ctx: ExecutionContext): Promise<Response>;
};
