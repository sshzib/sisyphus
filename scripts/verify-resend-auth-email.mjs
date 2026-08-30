const resendApiKey = requiredSecret("RESEND_API_KEY", "re_");
const sender =
  process.env.SISYPHUS_AUTH_EMAIL_FROM ??
  "Sisyphus Ai <noreply@sisyphusai.site>";
if (!/^Sisyphus(?: Ai)? <[^@\s]+@sisyphusai\.site>$/u.test(sender)) {
  throw new Error(
    "SISYPHUS_AUTH_EMAIL_FROM must be a Sisyphus sender on sisyphusai.site.",
  );
}

const testRun = Date.now().toString(36);
const name = "Sisyphus Template Test";
const messages = [
  {
    expected: [name, "http://localhost:3000/auth/confirm?type=recovery"],
    kind: "password-reset",
    recipient: `delivered+sisyphus-reset-${testRun}@resend.dev`,
    subject: "Reset your Sisyphus password",
    template: {
      id: "password-reset",
      variables: {
        name,
        reset_url: "http://localhost:3000/auth/confirm?type=recovery",
      },
    },
  },
  {
    expected: [
      name,
      "842913",
      "http://localhost:3000/auth/confirm?type=signup",
    ],
    kind: "email-verification",
    recipient: `delivered+sisyphus-verification-${testRun}@resend.dev`,
    subject: "Verify your Sisyphus email",
    template: {
      id: "email-verification",
      variables: {
        name,
        verification_code: "842913",
        verification_url: "http://localhost:3000/auth/confirm?type=signup",
      },
    },
  },
  {
    expected: [
      name,
      "http://localhost:3000/",
      "http://localhost:3000/privacy",
      "http://localhost:3000/unsubscribe",
    ],
    kind: "welcome-email",
    recipient: `delivered+sisyphus-welcome-${testRun}@resend.dev`,
    subject: "Welcome to Sisyphus",
    template: {
      id: "welcome-email",
      variables: {
        dashboard_url: "http://localhost:3000/",
        name,
        privacy_url: "http://localhost:3000/privacy",
        unsubscribe_url: "http://localhost:3000/unsubscribe",
      },
    },
  },
];

await verifyPublishedTemplates(messages.map((message) => message.template.id));

const sent = [];
for (const message of messages) {
  const response = await resendRequest("/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `sisyphus-template-check/${message.kind}/${testRun}`,
    },
    body: JSON.stringify({
      from: sender,
      to: [message.recipient],
      subject: message.subject,
      template: message.template,
      tags: [
        {
          name: "category",
          value: `auth_${message.kind.replaceAll("-", "_")}`,
        },
        { name: "environment", value: "verification" },
      ],
    }),
  });
  if (!isObject(response) || typeof response.id !== "string") {
    throw new Error(`Resend returned an invalid ${message.kind} send response.`);
  }
  sent.push({ ...message, id: response.id });
}

const results = [];
for (const message of sent) {
  let email;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    email = await resendRequest(`/emails/${message.id}`);
    if (!isObject(email) || typeof email.last_event !== "string") {
      throw new Error(`Resend returned an invalid ${message.kind} email record.`);
    }
    if (email.last_event === "delivered") break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  if (!isObject(email) || email.last_event !== "delivered") {
    throw new Error(`${message.kind} did not reach Resend's delivered state.`);
  }
  if (typeof email.html !== "string") {
    throw new Error(`${message.kind} did not include rendered HTML.`);
  }
  if (/\{\{\s*[^}]+\s*\}\}/u.test(email.html)) {
    throw new Error(`${message.kind} contains an unresolved template variable.`);
  }
  for (const expected of message.expected) {
    if (!email.html.includes(expected)) {
      throw new Error(`${message.kind} did not render an expected variable.`);
    }
  }
  results.push({
    id: message.id,
    kind: message.kind,
    lastEvent: email.last_event,
  });
}

console.log(JSON.stringify({ status: "delivered", messages: results }, null, 2));

async function verifyPublishedTemplates(aliases) {
  const response = await resendRequest("/templates");
  if (!isObject(response) || !Array.isArray(response.data)) {
    throw new Error("Resend returned an invalid template list.");
  }
  for (const alias of aliases) {
    const template = response.data.find(
      (candidate) =>
        isObject(candidate) &&
        candidate.alias === alias &&
        candidate.status === "published",
    );
    if (template === undefined) {
      throw new Error(`Resend template ${alias} is not published.`);
    }
  }
}

async function resendRequest(path, init = undefined) {
  const response = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "User-Agent": "sisyphus-auth-email-verifier/0.1.0",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const details = (await response.text()).replaceAll(resendApiKey, "[redacted]");
    throw new Error(
      `Resend request failed with HTTP ${response.status}: ${details}`,
    );
  }
  return response.json();
}

function requiredSecret(name, prefix) {
  const value = process.env[name];
  if (value === undefined || value.length < 20 || !value.startsWith(prefix)) {
    throw new Error(`${name} is required and must start with ${prefix}.`);
  }
  return value;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
