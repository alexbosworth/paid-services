const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const text = 'Pong!';

/** Derive a ping response. A ping is a very simple paid service that sends a
    pong message back to the sender.

  The pong should respond with an 805805 record with:

  0: (Standard Response Data)
    1: <Regular Text Message> // Pong!

  {}

  @returns via cbk or Promise
  {
    response: {
      text: <Response Text String>
    }
  }
*/
module.exports = ({}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Response to return
      response: cbk => cbk(null, {response: {text}}),
    },
    returnResult({reject, resolve, of: 'response'}, cbk));
  });
};
