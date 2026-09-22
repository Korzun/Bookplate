import { configuredChannels } from './notification-channels';

it('always offers push, which needs no server configuration', () => {
  expect(configuredChannels({ mail: null })).toEqual(['push']);
});

it('offers email as well once mail is configured', () => {
  const mail = {
    accountId: 'a',
    apiToken: 't',
    from: 'x@example.com',
    fromName: 'Library',
  };
  expect(configuredChannels({ mail })).toEqual(['email', 'push']);
});
