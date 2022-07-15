const {createHash} = require('crypto');
const EventEmitter = require('events');
const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {connectPeer} = require('ln-sync');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {parsePaymentRequest} = require('ln-service');
const {payViaPaymentDetails} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const completeOffToOnSwap = require('./complete_off_to_on_swap');
const decodeOffToOnResponse = require('./decode_off_to_on_response');
const {encodeTrade} = require('./../trades');
const makeRequest = require('./start_off_to_on_swap');
const {pushTypes} = require('./swap_field_types');
const {servicePeerRequests} = require('./../p2p');
const serviceTypes = require('./../service_types');

const bufferAsHex = buffer => buffer.toString('hex');
const defaultFeeRate = 5000;
const defaultMaxFeeForDeposit = 1337;
const defaultSwapAmount = 2500000;
const findRecord = (r, type) => (r.find(n => n.type === type) || {}).value;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isNumber = n => !isNaN(n) && !isNaN(parseFloat(n));
const makeSecret = () => randomBytes(32);
const minAmount = 10000;
const minRate = 0;
const mtokensAsTokens = n => Number(BigInt(n) / BigInt(1e3));
const pushSwapRequestMaxFee = 10;
const pushSwapRequestTokens = 10;
const rateDenominator = 1e6;
const rateForFee = (tokens, fee) => fee * 1e6 / tokens;
const sha256 = preimage => createHash('sha256').update(preimage).digest();
const typeKeySendPreimage = '5482373484';
const typeKeySendTrade = '805805';
const typeSwapResponse = serviceTypes.serviceTypeSwapResponse;

/** Request a swap out

  {
    ask: <Ask Function>
    [is_avoiding_broadcast]: <Avoid Broadcasting Bool>
    [is_external_funding]: <Externally Fund Swap Bool>
    [is_uncooperative]: <Avoid Cooperative Resolution Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [min_confirmations]: <Minimum Confirmations to Wait Number>
    [push_to]: <Push Swap Request to Node with Identity Public Key Hex String>
    [request]: <Request Function>
    [sweep_address]: <Sweep Chain Address String>
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

      // Attempt to connect to the push peer
      connect: ['validate', asyncReflect(({}, cbk) => {
        // Exit early when there is no push
        if (!args.push_to) {
          return cbk();
        }

        return connectPeer({id: args.push_to, lnd: args.lnd}, cbk);
      })],

      // Get the public key for node identity attachment
      getIdentity: ['validate', ({}, cbk) => {
        // Exit early when not pushing a request
        if (!args.push_to) {
          return cbk();
        }

        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Get the network name to decode the encoded swap payment request
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Ask for routing fee rate
      askForRate: ['askForTokens', ({}, cbk) => {
        // Exit earlyw hen there is no internal routing
        if (!!args.is_external_funding) {
          return cbk();
        }

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

      // Ask for the max swap fee rate that will be paid automatically
      askForSwapRate: ['askForRate', ({}, cbk) => {
        // Exit early when not pushing a swap request
        if (!args.push_to) {
          return cbk();
        }

        return args.ask({
          default: defaultFeeRate,
          message: 'Max auto-accept fee rate for funds in parts per million?',
          name: 'max',
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
        ({max}) => cbk(null, Number(max)));
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

      // Listen on p2p for a response to the swap request
      listenForResponse: [
        'getNetwork',
        'makeRequest',
        ({getNetwork, makeRequest}, cbk) =>
      {
        // Exit early when not pushing a request
        if (!args.push_to) {
          return cbk();
        }

        const service = servicePeerRequests({lnd: args.lnd});

        // The identifier of the swap is the hash over the swap request
        const id = bufferAsHex(sha256(hexAsBuffer(makeRequest.request)));

        // Listen for an accepted swap request
        service.request({type: typeSwapResponse}, (req, res) => {
          // Exit early when the request is from a different peer
          if (req.from !== args.push_to) {
            return;
          }

          // Exit early when the request is for a different swap
          if (findRecord(req.records, pushTypes.typeSwapId) !== id) {
            return;
          }

          // The peer will message the response to the swap in a record
          const response = findRecord(req.records, pushTypes.typeSwapResponse);

          // Check the swap response is valid
          try {
            decodeOffToOnResponse({response, network: getNetwork.bitcoinjs});
          } catch (err) {
            return res.failure([400, err.message]);
          }

          args.logger.info({got_response: true});

          // Tell the peer that the swap response was received
          res.success({});

          // Don't listen for additional results
          service.stop({});

          return cbk(null, response);
        });
      }],

      // Push the request to the destination
      pushRequest: [
        'askForSwapRate',
        'getIdentity',
        'makeRequest',
        ({getIdentity, makeRequest}, cbk) =>
      {
        // Exit early when this is not a push request
        if (!args.push_to) {
          return cbk();
        }

        const secret = makeSecret();

        const id = bufferAsHex(sha256(secret));

        // Include local peer details so the node can p2p message the response
        const {trade} = encodeTrade({
          swap: {node: getIdentity.public_key, request: makeRequest.request},
        });

        args.logger.info({
          sending_swap_request_to: args.push_to,
          push_request_id: id,
        });

        // Push the swap request
        return payViaPaymentDetails({
          id,
          destination: args.push_to,
          lnd: args.lnd,
          max_fee: pushSwapRequestMaxFee,
          messages: [
            {type: typeKeySendPreimage, value: bufferAsHex(secret)},
            {type: typeKeySendTrade, value: trade},
          ],
          tokens: pushSwapRequestTokens,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          args.logger.info({sent_swap_request_waiting_for_response: true});

          return cbk();
        });
      }],

      // Wait for a response
      getResponse: [
        'askForRate',
        'getNetwork',
        'listenForResponse',
        'makeRequest',
        ({getNetwork, listenForResponse, makeRequest}, cbk) =>
      {
        // Exit early when there is a p2p request
        if (!!listenForResponse) {
          return cbk(null, listenForResponse);
        }

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
        'askForSwapRate',
        'askForTokens',
        'getNetwork',
        'getResponse',
        ({askForSwapRate, askForTokens, getNetwork, getResponse}, cbk) =>
      {
        const response = decodeOffToOnResponse({
          network: getNetwork.bitcoinjs,
          response: getResponse,
        });

        const deposit = mtokensAsTokens(response.deposit_mtokens);
        const inbound = response.incoming_peer;
        const timeout = `that times out at ${response.timeout}`;
        const {tokens} = parsePaymentRequest({request: response.request});

        const fee = tokens - askForTokens;
        const pricing = `Execution cost ${deposit}, plus liquidity fee ${fee}`;

        // Exit early when swap fee is below the pre-specified tolerance
        if (rateForFee(askForTokens, deposit + fee) <= askForSwapRate) {
          return cbk(null, true)
        }

        const inPeer = !!args.is_external_funding ? ` in via ${inbound}` : '';

        return args.ask({
          default: true,
          message: `Start swap ${timeout}? ${pricing}${inPeer}?`,
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
          is_external_funding: args.is_external_funding,
          is_uncooperative: args.is_uncooperative,
          lnd: args.lnd,
          max_fee_deposit: defaultMaxFeeForDeposit,
          max_fee_funding: askForTokens * askForRate / rateDenominator,
          min_confirmations: args.min_confirmations,
          recovery: makeRequest.recovery,
          request: args.request,
          response: getResponse,
          sweep_address: args.sweep_address,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'completeSwap'}, cbk));
  });
};
