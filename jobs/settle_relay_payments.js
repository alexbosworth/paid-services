const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncMap = require('async/map');
const asyncUntil = require('async/until');
const {cancelHodlInvoice} = require('ln-service');
const {getHeight} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getPayment} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {settleHodlInvoice} = require('ln-service');

const after = () => new Date(Date.now() - (1000*60*60*24*30)).toISOString();
const allTimeouts = htlcs => htlcs.filter(n => n.is_held).map(n => n.timeout);
const cancelBlocksCount = 15;
const defaultInvoicesLimit = 100;
const {min} = Math;

/** Settle open relay payment HTLCs

  {
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
*/
module.exports = ({lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndApiToSettlePayments']);
        }

        return cbk();
      },

      // Get recent invoices
      getInvoices: ['validate', ({}, cbk) => {
        const invoices = [];
        let token;

        return asyncUntil(
          cbk => cbk(null, token === false),
          cbk => {
            return getInvoices({
              lnd,
              token,
              limit: !token ? defaultInvoicesLimit : undefined,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              token = res.next || false;

              const recent = res.invoices.filter(n => n.created_at >= after);

              // Sto paging when there are too-old invoices
              if (recent.length !== res.invoices.length) {
                token = false;
              }

              recent.forEach(n => invoices.push(n));

              return cbk();
            });
          },
          err => {
            return cbk(null, invoices);
          }
        );
      }],

      // Get thte current height
      getHeight: ['getInvoices', ({}, cbk) => getHeight({lnd}, cbk)],

      // Invoices with remaining blocks
      invoices: [
        'getHeight',
        'getInvoices',
        ({getHeight, getInvoices}, cbk) =>
      {
        const height = getHeight.current_block_height;
        const held = getInvoices.filter(n => n.is_held);

        const invoices = held.map(invoice => {
          return {
            blocks_remaining: min(...allTimeouts(invoice.payments)) - height,
            id: invoice.id,
          };
        });

        return cbk(null, invoices.filter(n => n.blocks_remaining > Number()));
      }],

      // Cancel held invoices that are about to expire
      cancelInvoices: ['invoices', ({invoices}, cbk) => {
        const expiring = invoices
          .filter(n => n.blocks_remaining < cancelBlocksCount);

        return asyncEach(expiring, ({id}, cbk) => {
          return cancelHodlInvoice({id, lnd}, () => cbk());
        },
        cbk);
      }],

      // Get payments that can be settled
      getPaymentSecrets: ['invoices', ({invoices}, cbk) => {
        const held = invoices
          .filter(n => n.blocks_remaining > cancelBlocksCount);

        return asyncMap(held, ({id}, cbk) => {
          return getPayment({id, lnd}, (err, res) => {
            // Exit early when there is no payment
            if (!res || !res.payment) {
              return cbk();
            }

            return cbk(null, res.payment.secret);
          });
        },
        cbk);
      }],

      // Settle held invoices
      takeHeldFunds: ['getPaymentSecrets', ({getPaymentSecrets}, cbk) => {
        return asyncEach(getPaymentSecrets.filter(n => !!n), (secret, cbk) => {
          return settleHodlInvoice({lnd, secret}, () => cbk());
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
