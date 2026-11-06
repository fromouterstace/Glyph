import {
  normalizeNativeRecipients,
  recipientGroups,
  type MessageRecipients,
} from './native-verification';
import { ComposerError } from './composer-policy';

export function webRecipients(
  input: MessageRecipients,
  current?: MessageRecipients,
) {
  const explicit = [input.toEmails, input.ccEmails, input.bccEmails].some(
    (list) => list !== undefined,
  );
  const old = current && recipientGroups(current);
  const grouped =
    old && (old.to.length > 1 || old.cc.length > 0 || old.bcc.length > 0);
  if (!explicit && grouped) {
    if (
      input.recipientEmail.toLowerCase() !==
      current!.recipientEmail.toLowerCase()
    )
      throw new ComposerError(
        400,
        'Include To, Cc and Bcc lists when changing this group message.',
      );
    return { toEmails: old.to, ccEmails: old.cc, bccEmails: old.bcc };
  }
  const result = normalizeNativeRecipients(input);
  if (!result)
    throw new ComposerError(
      400,
      'Enter 1–100 unique recipients across To, Cc and Bcc. Do not repeat an address across fields.',
    );
  return result;
}
