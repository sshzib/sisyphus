import type { AgentPatchProposal } from "@sisyphus/domain";

export interface ProductContract {
  readonly productName: "Sisyphus";
  readonly requiredVisibleTerms: readonly string[];
  readonly requiredConcepts: readonly string[];
  readonly forbiddenPlaceholderTerms: readonly string[];
}

export class WorkforceShapeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WorkforceShapeError";
  }
}

export function deriveProductContract(request: string): ProductContract | undefined {
  if (!/\bsisyphus\b/iu.test(request)) return undefined;
  return {
    productName: "Sisyphus",
    requiredVisibleTerms: ["Sisyphus"],
    requiredConcepts: ["AI Engineering HR", "agent workforce"],
    forbiddenPlaceholderTerms: ["Welcome to Our Website", "Simple Landing Page", "Logo"],
  };
}

export function isReviewRole(role: string): boolean {
  const normalizedRole = role.trim().toLowerCase();
  if (/(?:qa|quality|review|test|security)/iu.test(normalizedRole)) return true;
  if (isDesignAssuranceRole(normalizedRole)) return true;
  if (isImplementationRole(normalizedRole)) return false;
  return /(?:architect|product|requirements|research|design|accessibility|performance|documentation)/iu.test(
    normalizedRole,
  );
}

function isDesignAssuranceRole(role: string): boolean {
  if (/\b(?:engineer|developer|implementer|builder)\b/iu.test(role)) return false;
  return /\b(?:ui|ux|visual|product|frontend)?\s*(?:design|designer)\b/iu.test(role);
}

export function assignmentPhase(role: string): "build" | "review" {
  return isReviewRole(role) ? "review" : "build";
}

export function validateWorkforceShape(
  requirements: readonly { readonly specialistRole: string }[],
): void {
  const implementationRoles = requirements
    .map((requirement) => requirement.specialistRole.trim().toLowerCase())
    .filter((role) => !isReviewRole(role));
  const hasFullstack = implementationRoles.some((role) => /full[ -]?stack/iu.test(role));
  const hasSpecialistBuilder = implementationRoles.some(
    (role) => !/full[ -]?stack/iu.test(role),
  );
  if (hasFullstack && hasSpecialistBuilder) {
    throw new WorkforceShapeError(
      "The workforce plan cannot assign a full-stack owner alongside other implementation owners. Choose one ownership strategy.",
    );
  }
  const assignedDomains = new Set<string>();
  for (const role of implementationRoles) {
    const domain = implementationDomain(role);
    if (assignedDomains.has(domain)) {
      throw new WorkforceShapeError(
        `The workforce plan assigned more than one ${domain} implementation owner. Combine that domain into one isolated work package.`,
      );
    }
    assignedDomains.add(domain);
  }
}

function implementationDomain(role: string): string {
  if (/full[ -]?stack/iu.test(role)) return "full-stack";
  if (/(?:authentication|\bauth\b)/iu.test(role)) return "authentication";
  if (/database|data/iu.test(role)) return "database";
  if (/frontend|ui|ux|visual/iu.test(role)) return "frontend";
  if (/backend|api|server/iu.test(role)) return "backend";
  if (/devops|cloud|infrastructure|deploy/iu.test(role)) return "devops";
  return role;
}

function isImplementationRole(role: string): boolean {
  return /(?:full[ -]?stack|frontend|\bui\b|\bux\b|visual|authentication|\bauth\b|backend|api|server|database|data|devops|cloud|infrastructure|deploy)/iu.test(
    role,
  );
}

export function ownershipGuidance(role: string): string {
  const normalizedRole = role.trim().toLowerCase();
  if (isReviewRole(normalizedRole)) {
    return "You are evidence-only. You may write only one report inside reviews/ and must not edit application code.";
  }
  if (/frontend|ui|ux|visual/iu.test(normalizedRole)) {
    return "You own user-facing files such as index.html, styles.css, script.js, src/components/**, and src/app/**. Do not modify api/, server/, database/, backend/, infrastructure, or deployment files.";
  }
  if (/authentication|\bauth\b/iu.test(normalizedRole)) {
    return "You own only auth/**, lib/auth/**, and tests/auth/**. Do not modify frontend, API, database, infrastructure, or deployment files.";
  }
  if (/database|data/iu.test(normalizedRole)) {
    return "You own only database/**, db/**, prisma/**, migrations/**, and tests/database/**. Do not modify frontend, API, authentication, infrastructure, or deployment files.";
  }
  if (/backend|api|server/iu.test(normalizedRole)) {
    return "You own only api/**, server/**, backend/**, lib/server/**, and tests/api/**. Do not modify frontend, authentication, database, infrastructure, or deployment files.";
  }
  if (/devops|cloud|infrastructure|deploy/iu.test(normalizedRole)) {
    return "You own only infra/**, deploy/**, .github/**, and docker/**. Do not modify application source, authentication, API, database, or frontend files.";
  }
  return "Modify only files needed for your owned work package. Do not modify a file owned by another specialist.";
}

export function validateProposalPolicy(input: {
  readonly role: string;
  readonly proposal: AgentPatchProposal;
  readonly productContract: ProductContract | undefined;
}): readonly string[] {
  const errors: string[] = [];
  const paths = input.proposal.files.map((file) => file.path.replaceAll("\\", "/"));
  const role = input.role.trim().toLowerCase();

  if (isReviewRole(role)) {
    if (paths.some((path) => !path.startsWith("reviews/"))) {
      errors.push("Review and QA specialists may write evidence reports only under reviews/.");
    }
    if (input.proposal.verification === undefined) {
      errors.push("Review and QA specialists must return a structured verification verdict with their evidence report.");
    }
    return errors;
  }

  if (/frontend|ui|ux|visual/iu.test(role)) {
    if (paths.some((path) => /^(?:api|server|database|backend|infra|deploy)(?:\/|$)/iu.test(path))) {
      errors.push("The frontend assignment attempted to modify a backend-owned path.");
    }
  }

  if (/authentication|\bauth\b/iu.test(role)) {
    const allowed = /^(?:auth|lib\/auth|tests\/auth)(?:\/|$)/iu;
    if (paths.some((path) => !allowed.test(path))) {
      errors.push("The authentication assignment attempted to modify a path owned by another specialist.");
    }
  }

  if (/database|data/iu.test(role)) {
    const allowed = /^(?:database|db|prisma|migrations|tests\/database)(?:\/|$)/iu;
    if (paths.some((path) => !allowed.test(path))) {
      errors.push("The database assignment attempted to modify a path owned by another specialist.");
    }
  }

  if (/backend|api|server/iu.test(role)) {
    const allowed = /^(?:api|server|backend|lib\/server|tests\/api)(?:\/|$)|^(?:package\.json|\.env\.example)$/iu;
    if (paths.some((path) => !allowed.test(path))) {
      errors.push("The backend assignment attempted to modify a frontend-owned or shared path.");
    }
  }

  if (/devops|cloud|infrastructure|deploy/iu.test(role)) {
    const allowed = /^(?:infra|deploy|\.github|docker)(?:\/|$)/iu;
    if (paths.some((path) => !allowed.test(path))) {
      errors.push("The infrastructure assignment attempted to modify application-owned files.");
    }
  }

  if (input.productContract !== undefined && /frontend|ui|ux|visual|full[ -]?stack/iu.test(role)) {
    errors.push(...validateProductContract(input.proposal, input.productContract));
  }

  return errors;
}

function validateProductContract(
  proposal: AgentPatchProposal,
  contract: ProductContract,
): readonly string[] {
  const markup = proposal.files
    .filter((file) => /\.(?:html|tsx|jsx)$/iu.test(file.path))
    .map((file) => file.content);
  if (markup.length === 0) {
    return ["The Sisyphus user-facing assignment must include an HTML, TSX, or JSX view for deterministic branding checks."];
  }

  const content = markup.join("\n");
  const errors: string[] = [];
  if (!new RegExp(`\\b${contract.productName}\\b`, "iu").test(content)) {
    errors.push(`The visible product name ${contract.productName} is required.`);
  }
  if (!/<title[^>]*>[^<]*Sisyphus/iu.test(content)) {
    errors.push("The user-facing document title must include Sisyphus.");
  }
  if (!/<main\b[^>]*>[\s\S]*?<h1[^>]*>[\s\S]*?Sisyphus/iu.test(content)) {
    errors.push("The main page content must include a primary visible heading with Sisyphus; a header-only label is not sufficient.");
  }
  if (!/(?:AI\s+Engineering\s+HR|agent\s+workforce|engineering\s+workforce)/iu.test(content)) {
    errors.push("The page must explain the AI Engineering HR or agent-workforce concept.");
  }
  for (const placeholder of contract.forbiddenPlaceholderTerms) {
    if (content.includes(placeholder)) {
      errors.push(`Generic placeholder copy is not allowed: ${placeholder}.`);
    }
  }
  return errors;
}
