export type SystemAdminIdentity = {
  emailAddresses: Array<{
    emailAddress: string;
    verification?: { status?: string | null } | null;
  }>;
};

export function configuredSystemAdminEmails(value: string | undefined) {
  return new Set(
    (value ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function isSystemAdmin(
  userId: string | null | undefined,
  configuredEmails: string | undefined,
  getUser: (id: string) => Promise<SystemAdminIdentity>,
) {
  const allowed = configuredSystemAdminEmails(configuredEmails);
  if (!userId || !allowed.size) return false;

  const user = await getUser(userId);
  return user.emailAddresses.some(
    ({ emailAddress, verification }) =>
      verification?.status === 'verified' &&
      allowed.has(emailAddress.toLowerCase()),
  );
}
