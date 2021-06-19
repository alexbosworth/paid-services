const {encodeTlvStream} = require('bolt01');
const {test} = require('@alexbosworth/tap');

const method = require('./../../actions/inbox_action_arguments');

const encode = records => encodeTlvStream({records}).encoded;

const tests = [
  {
    args: {},
    description: 'Encoded arguments are expected',
    error: 'ExpectedValidTlvStreamEncodedInboxArguments',
  },
  {
    args: {
      encoded: encode([{
        type: '1', value: Buffer.from('reply').toString('hex'),
      }]),
    },
    description: 'A message is expected',
    error: 'ExpectedMesageToSendToInbox',
  },
  {
    args: {
      encoded: encode([{
        type: '0', value: Buffer.alloc(999).toString('hex'),
      }]),
    },
    description: 'A short message is expected',
    error: 'ExpectedShorterMessageToSendToInbox',
  },
  {
    args: {
      encoded: encode([
        {type: '0', value: Buffer.alloc(1).toString('hex')},
        {type: '1', value: Buffer.alloc(999).toString('hex')},
      ]),
    },
    description: 'A short reply is expected',
    error: 'ExpectedShorterReplyToAddressToSendToInbox',
  },
  {
    args: {
      encoded: encode([{
        type: '0', value: Buffer.from('hi').toString('hex'),
      }]),
    },
    description: 'Decoded arguments are returned',
    expected: {message: 'hi', reply: undefined},
  },
  {
    args: {
      encoded: encode([
        {type: '0', value: Buffer.from('hi').toString('hex')},
        {type: '1', value: Buffer.from('yo').toString('hex')},
      ]),
    },
    description: 'Decoded arguments with a reply are returned',
    expected: {message: 'hi', reply: 'yo'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, throws}) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got error');
    } else {
      const res = method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
