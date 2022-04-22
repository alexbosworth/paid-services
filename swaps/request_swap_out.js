const EventEmitter = require('events');

const asyncAuto = require('async/auto');
const {getNetwork} = require('ln-sync');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const completeOffToOnSwap = require('./complete_off_to_on_swap');
const decodeOffToOnResponse = require('./decode_off_to_on_response');
const makeRequest = require('./start_off_to_on_swap');

const defaultFeeRate = 5000;
const defaultMaxFeeForDeposit = 1337;
const defaultSwapAmount = 2500000;
const isNumber = n => !isNaN(n) && !isNaN(parseFloat(n));
const minAmount = 10000;
const minRate = 0;
const mtokensAsTokens = n => Number(BigInt(n) / BigInt(1e3));
const rateDenominator = 1e6;

/** Request a swap out

  {
    ask: <Ask Function>
    [is_avoiding_broadcast]: <Avoid Broadcasting Bool>
    [is_uncooperative]: <Avoid Cooperative Resolution Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [request]: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToRequestSwapOut']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRequestSwapOut']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToRequestSwapOut']);
        }

        return cbk();
      },

      // Ask for amount
      askForTokens: ['validate', ({}, cbk) => {
        return args.ask({
          default: defaultSwapAmount,
          message: 'Amount to swap?',
          name: 'tokens',
          validate: input => {
            if (!isNumber(input)) {
              return false;
            }

            if (Number(input) < minAmount) {
              return `A larger amount is required, minimum: ${minAmount}`;
            }

            return true;
          },
        },
        ({tokens}) => cbk(null, Number(tokens)));
      }],

      // Get the network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Ask for routing fee rate
      askForRate: ['askForTokens', ({}, cbk) => {
        return args.ask({
          default: defaultFeeRate,
          message: 'Max routing fee rate for swap funds in parts per million?',
          name: 'rate',
          validate: input => {
            if (!isNumber(input)) {
              return false;
            }

            if (Number(input) < minRate) {
              return `A larger rate is required, minimum: ${minRate}`;
            }

            return true;
          },
        },
        ({rate}) => cbk(null, Number(rate)));
      }],

      // Make a swap request
      makeRequest: ['askForTokens', ({askForTokens}, cbk) => {
        return makeRequest({
          is_external_solo_key: !!args.request,
          lnd: args.lnd,
          tokens: askForTokens,
        },
        cbk);
      }],

      // Wait for a response
      getResponse: [
        'askForRate',
        'getNetwork',
        'makeRequest',
        ({getNetwork, makeRequest}, cbk) =>
      {
        args.logger.info({swap_request: makeRequest.request});

        return args.ask({
          message: 'Response to swap request?',
          name: 'response',
          validate: response => {
            if (!response) {
              return;
            }

            try {
              decodeOffToOnResponse({response, network: getNetwork.bitcoinjs});
            } catch (err) {
              return 'Failed parse this response, check input?';
            }

            return true;
          },
        },
        ({response}) => cbk(null, response));
      }],

      // Confirm the swap details
      okSwap: [
        'askForTokens',
        'getNetwork',
        'getResponse',
        ({askForTokens, getNetwork, getResponse}, cbk) =>
      {
        const response = decodeOffToOnResponse({
          network: getNetwork.bitcoinjs,
          response: getResponse,
        });

        const deposit = mtokensAsTokens(response.deposit_mtokens);
        const timeout = `that times out at ${response.timeout}`;
        const {tokens} = parsePaymentRequest({request: response.request});

        const fee = tokens - askForTokens;
        const pricing = `Execution cost ${deposit}, plus liquidity fee ${fee}`;

        return args.ask({
          default: true,
          message: `Start swap ${timeout}? ${pricing}?`,
          name: 'ok',
          type: 'confirm',
        },
        ({ok}) => cbk(null, ok));
      }],

      // Complete the swap
      completeSwap: [
        'askForRate',
        'askForTokens',
        'getResponse',
        'makeRequest',
        'okSwap',
        ({askForRate, askForTokens, getResponse, makeRequest, okSwap}, cbk) =>
      {
        if (!okSwap) {
          return cbk([400, 'SwapCanceled']);
        }

        const emitter = new EventEmitter();

        emitter.on('update', update => args.logger.info(update));

        return completeOffToOnSwap({
          emitter,
          is_avoiding_broadcast: args.is_avoiding_broadcast,
          is_uncooperative: args.is_uncooperative,
          lnd: args.lnd,
          max_fee_deposit: defaultMaxFeeForDeposit,
          max_fee_funding: askForTokens * askForRate / rateDenominator,
          recovery: makeRequest.recovery,
          request: args.request,
          response: getResponse,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'completeSwap'}, cbk));
  });
};
