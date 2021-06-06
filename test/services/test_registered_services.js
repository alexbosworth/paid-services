const {test} = require('tap');

const method = require('./../../services/registered_services');

const tests = [
  {
    args: {env: {}},
    description: 'Services are returned',
    expected: {
      services: [
        {
          id: '0',
          description: 'Get details about a specific service',
          fields: undefined,
          is_enabled: true,
          name: 'schema',
        },
        {
          id: '1',
          description: 'Get a list of currently supported services',
          fields: undefined,
          is_enabled: true,
          name: 'services',
        },
        {
          id: '2',
          description: 'Get a pong response to a ping payment',
          fields: undefined,
          is_enabled: true,
          name: 'ping',
        },
        {
          id: '3',
          description: 'Get general information about this node',
          fields: undefined,
          is_enabled: false,
          name: 'profile',
        },
        {
          id: '4',
          description: 'Deliver a message to this node\'s inbox',
          fields: [
            {
              description: 'Message to deliver to inbox',
              limit: 280,
              type: '0',
            },
            {
              description: 'Reply email address or other contact method',
              limit: 144,
              type: '1',
            },
          ],
          is_enabled: false,
          name: 'inbox',
        },
        {
          id: '5',
          description: 'Get ids of other nodes offering paid services',
          fields: undefined,
          is_enabled: false,
          name: 'network',
        },
        {
          id: '6',
          description: 'Get routing activity statistics',
          fields: undefined,
          is_enabled: false,
          name: 'activity',
        },
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    const res = method(args);

    strictSame(res, expected, 'Got expected result');

    return end();
  });
});
