import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * The reader already holds `MAX_MCP_TOKENS_PER_USER` agent tokens. Decided by
 * a count inside `createMcpToken`'s transaction and returned as a value, the
 * same shape as `BookRequestLimitExceededError`.
 */
export type McpTokenLimitExceededErrorShape = {
  readonly __typename: 'McpTokenLimitExceededError';
  readonly message: string;
  readonly limit: number;
};

export const mcpTokenLimitExceededError = (limit: number): McpTokenLimitExceededErrorShape => ({
  __typename: 'McpTokenLimitExceededError',
  message: `You can have ${limit} agent tokens at a time. Revoke one first.`,
  limit,
});

export const model = builder
  .objectRef<McpTokenLimitExceededErrorShape>('McpTokenLimitExceededError')
  .implement({
    description: 'The reader already holds the maximum number of agent tokens.',
    interfaces: [userError],
    fields: (t) => ({
      limit: t.exposeInt('limit'),
    }),
  });
