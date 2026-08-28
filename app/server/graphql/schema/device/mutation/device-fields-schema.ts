import { z } from 'zod';

import { generateSlug } from '../../../../utils/slug';

/**
 * The `name`/`coverWidth`/`coverHeight` validation `deviceCreate` and
 * `deviceUpdate` share, extracted into one definition so the two mutations
 * cannot drift the way two independent copies could (review, task 7, I-1).
 * This is the direct GraphQL analogue of REST's own sharing, before Phase 0
 * removed it: `POST /` and `PATCH /:id` both called the exact same
 * `parseBody` function, so REST structurally could not have PATCH accept
 * something POST rejected (or vice versa). The same guarantee holds here —
 * `deviceCreate` and `deviceUpdate` both call this exact schema function, so
 * GraphQL structurally cannot have one accept something the other rejects —
 * before this extraction, the two GraphQL copies had no such guarantee, and
 * `update.test.ts` pinned none of these four rules, only `deviceId`'s.
 *
 * Mirrors `parseBody`'s checks on `name` exactly, in the same order:
 * required-after-trim, then the 50-character ceiling, then the "must derive
 * a non-empty slug" rule (a symbol-only name such as `"!!!"` would otherwise
 * break the unique `slug` column and the `/devices/:slug/download` URL).
 * `coverWidth`/`coverHeight` mirror `parseBody`'s `dim` helper: omitted or
 * explicit `null` both mean "no cap" (`DeviceInput`'s `number | null`), and a
 * provided value must be a positive integer. No `.int()` check — GraphQL's
 * `Int` coercion already rejects a non-integer before the resolver runs (see
 * `progressSet`'s identical note on `currentChapter`), so only positivity is
 * left to check.
 */
export const deviceFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'name is required')
    .max(50, 'name must be 50 characters or fewer')
    .refine(
      (value) => generateSlug(value).length > 0,
      'name must contain at least one letter or number'
    ),
  coverWidth: z.number().positive('coverWidth must be a positive integer').nullable(),
  coverHeight: z.number().positive('coverHeight must be a positive integer').nullable(),
});
