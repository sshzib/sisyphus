import type { FastifyReply, FastifyRequest } from "fastify";

export type TenantRole = "admin" | "member" | "viewer";

export type AuthContext =
  | {
      kind: "user";
      tenantId: string;
      subjectId: string;
      role: TenantRole;
    }
  | {
      kind: "device";
      tenantId: string;
      subjectId: string;
      adapterInstallationId: string;
      role: "device";
    };

export interface CredentialResolver {
  resolveCredential(token: string): Promise<AuthContext | undefined>;
}

declare module "fastify" {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}

export function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization === undefined || Array.isArray(authorization)) {
    return undefined;
  }
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(authorization);
  return match?.[1];
}

export function sendApiError(input: {
  reply: FastifyReply;
  request: FastifyRequest;
  status: number;
  error: string;
  message: string;
}): void {
  void input.reply.status(input.status).send({
    error: input.error,
    message: input.message,
    requestId: input.request.id,
  });
}

export function authenticated(request: FastifyRequest): AuthContext | undefined {
  return request.authContext ?? undefined;
}
