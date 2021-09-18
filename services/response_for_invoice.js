const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const {createInvoice} = require('ln-service');
const {decodeTlvStream} = require('bolt01');
const {returnResult} = require('asyncjs-util');

const {isInvoiceEnabled} = require('./../config');

const asString = value => Buffer.from(value, 'hex').toString('utf8');
const byteLength = hex => hex.length / 2;
const findAmount = records => records.find(n => n.type === '1');
const findDescription = records => records.find(n => n.type === '3');
const isNumber = n => !isNaN(n) && !isNaN(parseFloat(n));
const maxAmountByteLength = 20;
const maxDescriptionByteLength = 100;

/** Derive an invoice response. The invoice service creates an invoice

  {
    [arguments]: <Arguments TLV Stream Hex String>
    env: <Environment Variables Object>
    lnd: <Authenticated LND API Object>
    to: <Responding To Public Key Hex String>
  }

  @returns via cbk or Promise
  {
    [response]: {
      paywall: <Paywall BOLT 11 Request String>
      text: <Response Text String>
    }
  }
*/
module.exports = ({arguments, env, lnd, to}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        // Check that the arguments are a valid TLV stream
        if (!!arguments) {
          try {
            decodeTlvStream({encoded: arguments});
          } catch (err) {
            return cbk([400, 'ExpectedTlvStreamArgumentsForInvoiceService']);;
          }
        }

        if (!env) {
          return cbk([400, 'ExpectedEnvToGenerateInvoiceResponse']);
        }

        if (!isInvoiceEnabled({env})) {
          return cbk([404, 'InvoiceServiceNotEnabled']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToGenerateInvoiceServiceResponse']);
        }

        if (!to) {
          return cbk([400, 'ExpectedInvoiceResponseToForInvoiceResponse']);
        }

        return cbk();
      },

      // Decode the arguments
      arguments: ['validate', ({}, cbk) => {
        // Exit early when there are no arguments
        if (!arguments) {
          return cbk(null, {});
        }

        try {
          decodeTlvStream({encoded: arguments});
        } catch (err) {
          return cbk([400, 'ExpectedValidTlvStreamEncodedInvoiceArguments']);
        }

        const {records} = decodeTlvStream({encoded: arguments});

        const amount = findAmount(records);

        if (!!amount && byteLength(amount.value) > maxAmountByteLength) {
          return cbk([400, 'ExpectedShorterAmountForNewInvoice']);
        }

        if (!!amount && !isNumber(asString(amount.value))) {
          return cbk([400, 'ExpectedNumericValueForNewInvoice']);
        }

        const desc = findDescription(records);

        if (!!desc && byteLength(desc.value) > maxDescriptionByteLength) {
          throw new Error('ExpectedShorterDescriptionForNewInvoice');
        }

        return cbk(null, {
          description: !!desc ? asString(desc.value) : undefined,
          tokens: !!amount ? parseInt(asString(amount.value)) : undefined,
        });
      }],

      // Add the invoice
      createInvoice: ['arguments', ({arguments}, cbk) => {
        return createInvoice({
          lnd,
          description: `${arguments.description || 'invoice'} for ${to}`,
          tokens: arguments.tokens,
        },
        cbk);
      }],

      // Response to return
      response: ['createInvoice', ({createInvoice}, cbk) => {
        return cbk(null, {
          response: {
            paywall: createInvoice.request,
            text: `Created invoice!`,
          },
        });
      }],
    },
    returnResult({reject, resolve, of: 'response'}, cbk));
  });
};
