const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const getOfferInvoice = require('./get_offer_invoice');
const payOfferInvoice = require('./pay_offer_invoice');

const {isSafeInteger} = Number;
const isMtokens = n => typeof n === 'string' && /^\d+$/.test(n);
const isTimeout = n => isSafeInteger(n) && n > 0;

/** Pay a BOLT 12 offer: `getOfferInvoice` and then `payOfferInvoice`

  `mtokens` defaults to the offer amount, and is required when the offer has
  no amount, or an amount in a currency. Give the `bip353_name` that the
  offer was found with, as BOLT 12 requires.

  {
    [bip353_name]: <BIP 353 Human Readable Name Offer Was Found With String>
    lnd: <Authenticated LND API Object>
    max_fee_mtokens: <Maximum Routing Fee Millitokens String>
    [mtokens]: <Millitokens to Pay String>
    offer: <BOLT 12 Offer String>
    [payer_note]: <Payer Note String>
    [timeout]: <Wait For Invoice Over Each Offer Path Milliseconds Number>
  }

  @returns via cbk or Promise
  {
    fee_mtokens: <Fee Paid Millitokens String>
    id: <Payment Hash Hex String>
    invoice: <BOLT 12 Invoice String>
    mtokens: <Invoice Amount Millitokens String>
    payer_id: <Payer Public Key Hex String>
    payer_secret: <Payer Secret Key Hex String>
    secret: <Payment Preimage Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToPayOffer']);
        }

        // A fee limit is required so that fees cannot run up unchecked
        if (!isMtokens(args.max_fee_mtokens)) {
          return cbk([400, 'ExpectedMaxFeeMillitokensToPayOffer']);
        }

        if (!args.offer || typeof args.offer !== 'string') {
          return cbk([400, 'ExpectedOfferToPay']);
        }

        if (args.timeout !== undefined && !isTimeout(args.timeout)) {
          return cbk([400, 'ExpectedTimeoutMillisecondsToPayOffer']);
        }

        return cbk();
      },

      // Get an invoice for the offer
      getInvoice: ['validate', ({}, cbk) => {
        return getOfferInvoice({
          bip353_name: args.bip353_name,
          lnd: args.lnd,
          mtokens: args.mtokens,
          offer: args.offer,
          payer_note: args.payer_note,
          timeout: args.timeout,
        },
        cbk);
      }],

      // Pay the invoice
      pay: ['getInvoice', ({getInvoice}, cbk) => {
        return payOfferInvoice({
          invoice: getInvoice.invoice,
          lnd: args.lnd,
          max_fee_mtokens: args.max_fee_mtokens,
        },
        cbk);
      }],

      // The payment of the offer
      paid: ['getInvoice', 'pay', ({getInvoice, pay}, cbk) => {
        return cbk(null, {
          fee_mtokens: pay.fee_mtokens,
          id: pay.id,
          invoice: getInvoice.invoice,
          mtokens: pay.mtokens,
          payer_id: getInvoice.payer_id,
          payer_secret: getInvoice.payer_secret,
          secret: pay.secret,
        });
      }],
    },
    returnResult({reject, resolve, of: 'paid'}, cbk));
  });
};
