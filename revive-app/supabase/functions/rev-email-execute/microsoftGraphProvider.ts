export type MicrosoftGraphEmail = {
  recipient: string;
  subject: string;
  body: string;
};

export type MicrosoftGraphSendResult = {
  outcome: 'accepted_by_provider';
  acceptedAt: string;
  actualCost: 0;
};

export type MicrosoftGraphProviderConfig = {
  accessToken: string;
  senderUserId: string;
};

export class MicrosoftGraphRejectedError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MicrosoftGraphRejectedError';
    this.status = status;
  }
}

export class MicrosoftGraphOutcomeUnknownError extends Error {
  constructor(message = 'Microsoft Graph provider outcome is unknown.') {
    super(message);
    this.name = 'MicrosoftGraphOutcomeUnknownError';
  }
}

export async function sendMicrosoftGraphEmail(
  email: MicrosoftGraphEmail,
  config: MicrosoftGraphProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<MicrosoftGraphSendResult> {
  const accessToken = config.accessToken.trim();
  const senderUserId = config.senderUserId.trim();

  if (!accessToken) throw new Error('Microsoft Graph access token is required.');
  if (!senderUserId) throw new Error('Microsoft Graph sender user ID is required.');
  if (!email.recipient.trim()) throw new Error('Email recipient is required.');
  if (!email.subject.trim()) throw new Error('Email subject is required.');
  if (!email.body.trim()) throw new Error('Email body is required.');

  let response: Response;

  try {
    response = await fetchImpl(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderUserId)}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            subject: email.subject,
            body: {
              contentType: 'Text',
              content: email.body,
            },
            toRecipients: [
              {
                emailAddress: {
                  address: email.recipient,
                },
              },
            ],
          },
          saveToSentItems: true,
        }),
      },
    );
  } catch {
    throw new MicrosoftGraphOutcomeUnknownError();
  }

  if (response.status === 202) {
    return {
      outcome: 'accepted_by_provider',
      acceptedAt: new Date().toISOString(),
      actualCost: 0,
    };
  }

  if (response.status === 401 || response.status === 403) {
    throw new MicrosoftGraphRejectedError(
      response.status,
      'Microsoft Graph authentication or Mail.Send authorization failed.',
    );
  }

  if (response.status === 429) {
    throw new MicrosoftGraphRejectedError(
      response.status,
      'Microsoft Graph rate limit reached.',
    );
  }

  throw new MicrosoftGraphRejectedError(
    response.status,
    `Microsoft Graph rejected the email request with HTTP ${response.status}.`,
  );
}
