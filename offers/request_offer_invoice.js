const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {returnResult} = require('asyncjs-util');

const checkOfferInvoiceReply = require('./check_offer_invoice_reply');
const replyIntroduction = require('./../network/reply_introduction');
const {requestNetworkReply} = require('./../network');
const {typeInvoice} = require('./constants');
const {typeInvoiceError} = require('./constants');
const {typeInvoiceRequest} = require('./constants');

const {isArray} = Array;
const isAnswered = replies => replies.some(n => !!n.error || !!n.invoice);

/** Send an invoice request over an offer path and add the reply to replies

  No request is sent when the recipient already answered over another path,
  with an invoice, or with an invoice error that says why there is no invoice.

  A path that gives no reply, or a reply that is not a good invoice, is added
  as a failure, so that the request can be sent over the next path.

  {
    lnd: <Authenticated LND API Object>
    path: {
      hops: [{
        encrypted_data: <Encrypted Recipient Data Hex String>
        relay_key: <Blinded Relaying Node Public Key Hex String>
      }]
      introduction_node: <Introduction Node Public Key Hex String>
      key: <First Hop Path Key Public Key Hex String>
    }
    peers: [{
      features: [{
        bit: <BOLT 09 Feature Bit Number>
      }]
      public_key: <Peer Public Key Hex String>
    }]
    replies: [<Reply Object>]
    request: {
      encoded: <Signed Invoice Request TLV Stream Hex String>
      mtokens: <Requested Millitokens String>
      request: <BOLT 12 Invoice Request String>
    }
    timeout: <Wait For Reply Milliseconds Number>
  }

  @returns via cbk or Promise
  [{
    [err]: [<Failure Code Number>, <Failure Message String>, <Details Object>]
    [error]: [<Error Code Number>, <Error Message String>, <Details Object>]
    [invoice]: {
      expires_at: <Invoice Expires At ISO 8601 Date String>
      features: [{
        bit: <BOLT 09 Feature Bit Number>
        is_required: <Feature Support is Required To Pay Bool>
        type: <Feature Type String>
      }]
      id: <Payment Hash Hex String>
      invoice: <BOLT 12 Invoice String>
      mtokens: <Invoice Amount Millitokens String>
      paths: [<Invoice Payment Path Object>]
    }
    [is_reply]: <Failure Is a Recipient Reply Bool>
  }]
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToRequestOfferInvoice']);
        }

        if (!args.path) {
          return cbk([400, 'ExpectedOfferPathToRequestOfferInvoice']);
        }

        if (!isArray(args.peers)) {
          return cbk([400, 'ExpectedPeersToRequestOfferInvoice']);
        }

        if (!isArray(args.replies)) {
          return cbk([400, 'ExpectedRepliesToRequestOfferInvoice']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedInvoiceRequestToRequestOfferInvoice']);
        }

        if (!args.timeout) {
          return cbk([400, 'ExpectedTimeoutToRequestOfferInvoice']);
        }

        return cbk();
      },

      // Send the request over the path, unless the recipient already answered
      getReply: ['validate', asyncReflect(({}, cbk) => {
        // Exit early when there is no need to send the request again
        if (isAnswered(args.replies)) {
          return cbk();
        }

        const {introduction} = replyIntroduction({
          path: args.path,
          peers: args.peers,
        });

        return requestNetworkReply({
          introduction,
          lnd: args.lnd,
          message: {type: typeInvoiceRequest, value: args.request.encoded},
          path: args.path,
          timeout: args.timeout,
          types: [typeInvoice, typeInvoiceError],
        },
        cbk);
      })],

      // Add the reply over the path to the replies
      replies: ['getReply', ({getReply}, cbk) => {
        // Exit early when the request was not sent
        if (!getReply.error && !getReply.value) {
          return cbk(null, args.replies);
        }

        // Exit early when there was no reply, so the next path is tried
        if (!!getReply.error) {
          return cbk(null, [].concat(args.replies, {err: getReply.error}));
        }

        const {reply} = getReply.value;

        const {error, invoice} = checkOfferInvoiceReply({
          reply,
          path: args.path,
          request: args.request,
        });

        // Exit early when the recipient said why there is no invoice
        if (!!error && reply.type === typeInvoiceError) {
          return cbk(null, [].concat(args.replies, {error}));
        }

        const failure = {err: error, is_reply: true};

        // Exit early when the reply is not a good invoice
        if (!!error) {
          return cbk(null, [].concat(args.replies, failure));
        }

        return cbk(null, [].concat(args.replies, {invoice}));
      }],
    },
    returnResult({reject, resolve, of: 'replies'}, cbk));
  });
};
