const asyncAuto = require('async/auto');
const asyncReduce = require('async/reduce');
const {createSignedInvoiceRequest} = require('invoices');
const {getNetwork} = require('ln-sync');
const {getPublicKey} = require('ln-service');
const {pointFromScalar} = require('tiny-secp256k1');
const {returnResult} = require('asyncjs-util');
const {signBytes} = require('ln-service');

const invoiceRequestForOffer = require('./invoice_request_for_offer');
const offerInvoiceFailure = require('./offer_invoice_failure');
const {payerKeyFamily} = require('./constants');
const requestOfferInvoice = require('./request_offer_invoice');
const {resolvePathIntroductions} = require('./../network');

const {isSafeInteger} = Number;
const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const defaultTimeoutMs = 30000;
const isTimeout = n => isSafeInteger(n) && n > 0;
const placeholderPayerId = bufferAsHex(pointFromScalar(Buffer.alloc(32, 1)));
const typeSchnorr = 'schnorr';

/** Get an invoice for a BOLT 12 offer

  `mtokens` defaults to the offer amount, and is required when the offer has
  no amount. An offer with an amount in a currency is not supported. Give the
  `bip353_name` that the offer was found with, as BOLT 12 requires.

  The request is sent over each path of the offer in turn, waiting `timeout`
  for each, until a path gives back an invoice, or the recipient replies
  with an invoice error, which is returned. An offer without paths has the
  request sent to its issuer id. The reply path of a request goes back along
  its route, so that the recipient can reach it. The route to the start of a
  path is found over the public graph and the channels of the payer, so a
  payer that is only connected through a peer that is itself private is not
  supported.

  The request is signed by the `payer_id`, a new key that LND derives in key
  family 808 at `payer_key_index`, only once the request is known to be one
  that can be made, so that a refused request uses no index. Keep the index
  to be able to prove, with the key derived again from the seed, that the
  request and the payment of its invoice were made by the payer.

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
    [description]: <Offer Description String>
    expires_at: <Invoice Expires At ISO 8601 Date String>
    features: [{
      bit: <BOLT 09 Feature Bit Number>
      is_required: <Feature Support is Required To Pay Bool>
      type: <Feature Type String>
    }]
    id: <Payment Hash Hex String>
    invoice: <BOLT 12 Invoice String>
    mtokens: <Invoice Amount Millitokens String>
    paths: [{
      base_fee_mtokens: <Accumulated Base Fee Millitokens String>
      cltv_delta: <Accumulated CLTV Expiry Delta Number>
      fee_rate: <Accumulated Fee Rate Millitokens Per Million Number>
      hops: [{
        encrypted_data: <Encrypted Recipient Data Hex String>
        relay_key: <Blinded Relaying Node Public Key Hex String>
      }]
      introduction_node: <Introduction Node Public Key Hex String>
      key: <First Hop Path Key Public Key Hex String>
      max_htlc_mtokens: <Maximum HTLC Millitokens String>
      min_htlc_mtokens: <Minimum HTLC Millitokens String>
    }]
    payer_id: <Payer Public Key Hex String>
    payer_key_index: <Payer Id Key Index Number>
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

      // Make the request with a placeholder payer id, to check that it can be
      // made before a payer key is derived for it
      checkRequest: ['getNetwork', ({getNetwork}, cbk) => {
        try {
          return cbk(null, invoiceRequestForOffer({
            bip353_name: args.bip353_name,
            mtokens: args.mtokens,
            network: getNetwork.bitcoinjs,
            offer: args.offer,
            payer_id: placeholderPayerId,
            payer_note: args.payer_note,
          }));
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Find the introduction node of each offer path to send the request to
      getPaths: ['checkRequest', ({checkRequest}, cbk) => {
        return resolvePathIntroductions({
          lnd: args.lnd,
          paths: checkRequest.paths,
        },
        cbk);
      }],

      // The offer paths to send the request over
      offerPaths: ['getPaths', ({getPaths}, cbk) => {
        // Exit early when no path has a known introduction node
        if (!getPaths.paths.length) {
          return cbk([503, 'FailedToFindIntroductionNodesOfOfferPaths']);
        }

        return cbk(null, getPaths.paths);
      }],

      // Get a new derived key for the payer id, to derive again from the seed
      getPayerKey: ['offerPaths', ({}, cbk) => {
        return getPublicKey({family: payerKeyFamily, lnd: args.lnd}, cbk);
      }],

      // Make the unsigned invoice request for the offer with the payer id
      unsigned: [
        'getNetwork',
        'getPayerKey',
        ({getNetwork, getPayerKey}, cbk) =>
      {
        try {
          return cbk(null, invoiceRequestForOffer({
            bip353_name: args.bip353_name,
            mtokens: args.mtokens,
            network: getNetwork.bitcoinjs,
            offer: args.offer,
            payer_id: getPayerKey.public_key,
            payer_note: args.payer_note,
          }));
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Sign the request with the payer id key, which never leaves LND
      sign: ['getPayerKey', 'unsigned', ({getPayerKey, unsigned}, cbk) => {
        return signBytes({
          key_family: payerKeyFamily,
          key_index: getPayerKey.index,
          lnd: args.lnd,
          preimage: unsigned.root,
          tag: unsigned.tag,
          type: typeSchnorr,
        },
        cbk);
      }],

      // Finish the request with its signature, to send it
      request: ['sign', 'unsigned', ({sign, unsigned}, cbk) => {
        try {
          const {encoded, request} = createSignedInvoiceRequest({
            encoded: unsigned.encoded,
            signature: sign.signature,
          });

          return cbk(null, {encoded, request, mtokens: unsigned.mtokens});
        } catch (err) {
          return cbk([503, 'FailedToCreateSignedInvoiceRequest', {err}]);
        }
      }],

      // Send the request over each path in turn until the recipient answers
      getReplies: ['offerPaths', 'request', ({offerPaths, request}, cbk) => {
        return asyncReduce(offerPaths, [], (replies, path, cbk) => {
          return requestOfferInvoice({
            path,
            replies,
            request,
            lnd: args.lnd,
            timeout: args.timeout || defaultTimeoutMs,
          },
          cbk);
        },
        cbk);
      }],

      // The invoice the recipient answered with
      getInvoice: ['getReplies', ({getReplies}, cbk) => {
        const answer = getReplies.find(n => !!n.error || !!n.invoice);

        // Exit early when no path gave back an answer from the recipient
        if (!answer) {
          const failures = getReplies.filter(n => !!n.err);

          return cbk(offerInvoiceFailure({failures}).error);
        }

        // Exit early when the recipient said why there is no invoice
        if (!!answer.error) {
          return cbk(answer.error);
        }

        return cbk(null, answer.invoice);
      }],

      // Find the introduction node of each invoice path, to pay over it
      getPaymentPaths: ['getInvoice', ({getInvoice}, cbk) => {
        return resolvePathIntroductions({
          lnd: args.lnd,
          paths: getInvoice.paths,
        },
        cbk);
      }],

      // The payment paths to pay the invoice over
      paymentPaths: ['getPaymentPaths', ({getPaymentPaths}, cbk) => {
        // Exit early when no payment path has a known introduction node
        if (!getPaymentPaths.paths.length) {
          return cbk([503, 'FailedToFindStartOfPaymentPathsForOfferInvoice']);
        }

        return cbk(null, getPaymentPaths.paths.map(path => ({
          base_fee_mtokens: path.base_fee_mtokens,
          cltv_delta: path.cltv_delta,
          fee_rate: path.fee_rate,
          hops: path.hops,
          introduction_node: path.introduction_node,
          key: path.key,
          max_htlc_mtokens: path.max_htlc_mtokens,
          min_htlc_mtokens: path.min_htlc_mtokens,
        })));
      }],

      // The invoice for the request
      invoice: [
        'getInvoice',
        'getPayerKey',
        'paymentPaths',
        'unsigned',
        ({getInvoice, getPayerKey, paymentPaths, unsigned}, cbk) =>
      {
        return cbk(null, {
          description: unsigned.description,
          expires_at: getInvoice.expires_at,
          features: getInvoice.features,
          id: getInvoice.id,
          invoice: getInvoice.invoice,
          mtokens: getInvoice.mtokens,
          paths: paymentPaths,
          payer_id: getPayerKey.public_key,
          payer_key_index: getPayerKey.index,
        });
      }],
    },
    returnResult({reject, resolve, of: 'invoice'}, cbk));
  });
};
