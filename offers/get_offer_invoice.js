const asyncAuto = require('async/auto');
const asyncTryEach = require('async/tryEach');
const {getNetwork} = require('ln-sync');
const {getPeers} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const checkOfferInvoiceReply = require('./check_offer_invoice_reply');
const invoiceRequestForOffer = require('./invoice_request_for_offer');
const offerInvoiceFailure = require('./offer_invoice_failure');
const replyIntroduction = require('./../network/reply_introduction');
const {requestNetworkReply} = require('./../network');
const {resolvePathIntroductions} = require('./../network');
const {typeInvoice} = require('./constants');
const {typeInvoiceError} = require('./constants');
const {typeInvoiceRequest} = require('./constants');

const {isSafeInteger} = Number;
const defaultTimeoutMs = 30000;
const isTimeout = n => isSafeInteger(n) && n > 0;

/** Get an invoice for a BOLT 12 offer

  `mtokens` defaults to the offer amount, and is required when the offer has
  no amount, or an amount in a currency. Give the `bip353_name` that the
  offer was found with, as BOLT 12 requires.

  The request is sent over each path of the offer in turn, waiting `timeout`
  for each, until a path gives back an invoice, or the recipient replies
  with an invoice error, which is returned. Keep `payer_secret`, the key of
  the payer id, to be able to prove that the request was made by the payer.

  {
    [bip353_name]: <BIP 353 Human Readable Name Offer Was Found With String>
    lnd: <Authenticated LND API Object>
    [mtokens]: <Millitokens to Pay String>
    offer: <BOLT 12 Offer String>
    [payer_note]: <Payer Note String>
    [timeout]: <Wait For Invoice Over Each Path Milliseconds Number>
  }

  @returns via cbk or Promise
  {
    expires_at: <Invoice Expires At ISO 8601 Date String>
    id: <Payment Hash Hex String>
    invoice: <BOLT 12 Invoice String>
    mtokens: <Invoice Amount Millitokens String>
    payer_id: <Payer Public Key Hex String>
    payer_secret: <Payer Secret Key Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetOfferInvoice']);
        }

        if (!args.offer || typeof args.offer !== 'string') {
          return cbk([400, 'ExpectedOfferToGetOfferInvoice']);
        }

        if (args.timeout !== undefined && !isTimeout(args.timeout)) {
          return cbk([400, 'ExpectedTimeoutMillisecondsToGetOfferInvoice']);
        }

        return cbk();
      },

      // Get the network of the node to pay the offer on
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get the connected peers to start the reply path at one of them
      getPeers: ['validate', ({}, cbk) => getPeers({lnd: args.lnd}, cbk)],

      // Make the signed invoice request for the offer
      request: ['getNetwork', ({getNetwork}, cbk) => {
        try {
          return cbk(null, invoiceRequestForOffer({
            bip353_name: args.bip353_name,
            mtokens: args.mtokens,
            network: getNetwork.bitcoinjs,
            offer: args.offer,
            payer_note: args.payer_note,
          }));
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Find the introduction node of each offer path, to not reply from it
      getPaths: ['request', ({request}, cbk) => {
        return resolvePathIntroductions({
          lnd: args.lnd,
          paths: request.paths,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          // Exit early when no path has a known introduction node
          if (!res.paths.length) {
            return cbk([503, 'FailedToFindIntroductionNodesOfOfferPaths']);
          }

          return cbk(null, res.paths);
        });
      }],

      // Send the request over each path in turn until there is an invoice
      getInvoice: [
        'getPaths',
        'getPeers',
        'request',
        ({getPaths, getPeers, request}, cbk) =>
      {
        const failures = [];

        // Make a task to send the request over a path and check the reply
        const requestOver = path => cbk => {
          const {introduction} = replyIntroduction({
            path,
            peers: getPeers.peers,
          });

          return requestNetworkReply({
            introduction,
            path,
            lnd: args.lnd,
            message: {type: typeInvoiceRequest, value: request.encoded},
            timeout: args.timeout || defaultTimeoutMs,
            types: [typeInvoice, typeInvoiceError],
          },
          (err, res) => {
            // Exit early and try the next path when there was no reply
            if (!!err) {
              failures.push({err});

              return cbk(err);
            }

            const {error, invoice} = checkOfferInvoiceReply({
              request,
              reply: res.reply,
            });

            // Exit early and stop when the recipient sent an invoice error,
            // since it got the request and said why there is no invoice
            if (!!error && res.reply.type === typeInvoiceError) {
              return cbk(null, {error});
            }

            // Exit early and try the next path when there is no good invoice
            if (!!error) {
              failures.push({err: error, is_reply: true});

              return cbk(error);
            }

            return cbk(null, {invoice});
          });
        };

        return asyncTryEach(getPaths.map(requestOver), (err, res) => {
          if (!!err) {
            return cbk(offerInvoiceFailure({failures}).error);
          }

          // Exit early when the recipient said why there is no invoice
          if (!!res.error) {
            return cbk(res.error);
          }

          return cbk(null, res.invoice);
        });
      }],

      // The invoice for the request
      invoice: ['getInvoice', 'request', ({getInvoice, request}, cbk) => {
        return cbk(null, {
          expires_at: getInvoice.expires_at,
          id: getInvoice.id,
          invoice: getInvoice.invoice,
          mtokens: getInvoice.mtokens,
          payer_id: request.payer_id,
          payer_secret: request.payer_secret,
        });
      }],
    },
    returnResult({reject, resolve, of: 'invoice'}, cbk));
  });
};
