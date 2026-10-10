const {decodeTlvStream} = require('bolt01');

const {typeReplyTooLarge} = require('./constants');

/** Find out if an invoice error says that the reply was too large to send

  {
    encoded: <Invoice Error TLV Stream Hex String>
  }

  @returns
  {
    is_reply_too_large: <Reply Was Too Large Bool>
  }
*/
module.exports = ({encoded}) => {
  try {
    const types = decodeTlvStream({encoded}).records.map(n => n.type);

    return {is_reply_too_large: types.includes(typeReplyTooLarge)};
  } catch (err) {
    return {is_reply_too_large: false};
  }
};
