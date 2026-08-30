import { z } from "zod";

const AuthEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));
const AuthPasswordSchema = z.string().min(8).max(128);
const AuthNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\u0000-\u001f\u007f]+$/u);

const EmailPasswordSchema = z
  .object({
    email: AuthEmailSchema,
    password: AuthPasswordSchema,
  })
  .strict();

const PasswordUpdateSchema = z
  .object({
    password: AuthPasswordSchema,
    passwordConfirmation: AuthPasswordSchema,
  })
  .strict()
  .refine((input) => input.password === input.passwordConfirmation, {
    message: "Passwords must match.",
    path: ["passwordConfirmation"],
  });

const AuthContinuationSchema = z.literal("/auth/update-password");

const SignUpCredentialsSchema = z
  .object({
    email: AuthEmailSchema,
    name: AuthNameSchema,
    password: AuthPasswordSchema,
  })
  .strict();

export type EmailPassword = z.infer<typeof EmailPasswordSchema>;
export type PasswordUpdate = z.infer<typeof PasswordUpdateSchema>;
export type SignUpCredentials = z.infer<typeof SignUpCredentialsSchema>;

export function parseAuthEmail(input: unknown): string {
  return AuthEmailSchema.parse(input);
}

export function parseEmailPassword(input: unknown): EmailPassword {
  return EmailPasswordSchema.parse(input);
}

export function parsePasswordUpdate(input: unknown): PasswordUpdate {
  return PasswordUpdateSchema.parse(input);
}

export function parseSignUpCredentials(input: unknown): SignUpCredentials {
  return SignUpCredentialsSchema.parse(input);
}

export function safeAuthContinuation(
  input: unknown,
): "/auth/update-password" | undefined {
  const result = AuthContinuationSchema.safeParse(input);
  return result.success ? result.data : undefined;
}

export const SupabaseAccessTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(16_384)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
