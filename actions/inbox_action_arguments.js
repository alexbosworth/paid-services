const {decodeTlvStream} = require('bolt01');

const asString = value => Buffer.from(value, 'hex').toString('utf8');
const byteLength = hex => hex.length / 2;
const findMessage = records => records.find(n => !!n.value && n.type === '0');
const findReplyTo = records => records.find(n => n.type === '1');
const maxMessageByteLength = 280;
const maxReplyByteLength = 144;

/** Derive inbox message and reply to address from encoded TLV stream

  The TLV stream:
  0: <UTF8 Message String> (max 280 bytes)
  [1]: <UTF8 Reply To String> (max 144 bytes)

  {
    encoded: <Encoded TLV Stream Hex String>
  }

  @throws
  <Error>

  @returns
  {
    message: <Inbox Message String>
    [reply]: <Reply To Address String>
  }
*/
module.exports = ({encoded}) => {
  try {
    decodeTlvStream({encoded});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamEncodedInboxArguments');
  }

  const {records} = decodeTlvStream({encoded});

  const message = findMessage(records);

  if (!message) {
    throw new Error('ExpectedMesageToSendToInbox');
  }

  if (byteLength(message.value) > maxMessageByteLength) {
    throw new Error('ExpectedShorterMessageToSendToInbox');
  }

  const replyTo = findReplyTo(records);

  if (!!replyTo && byteLength(replyTo.value) > maxReplyByteLength) {
    throw new Error('ExpectedShorterReplyToAddressToSendToInbox');
  }

  return {
    message: asString(message.value),
    reply: !!replyTo ? asString(replyTo.value) : undefined,
  };
};
