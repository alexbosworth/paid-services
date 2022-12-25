const {createHash} = require('crypto');
const EventEmitter = require('events');
const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {connectPeer} = require('ln-sync');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getSwapOutTerms} = require('goldengate');
const {lightningLabsSwapAuth} = require('goldengate');
const {lightningLabsSwapService} = require('goldengate');
const {parsePaymentRequest} = require('ln-service');
const {payViaPaymentDetails} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const completeOffToOnSwap = require('./complete_off_to_on_swap');
const decodeLoopResponse = require('./decode_loop_response');
const decodeOffToOnRequest = require('./decode_off_to_on_request');
const decodeOffToOnResponse = require('./decode_off_to_on_response');
const encodeOffToOnRestart = require('./encode_off_to_on_restart');
const {encodeTrade} = require('./../trades');
const makeRequest = require('./start_off_to_on_swap');
const {pushTypes} = require('./swap_field_types');
const requestLoopOut = require('./request_loop_out');
const {servicePeerRequests} = require('./../p2p');
const serviceTypes = require('./../service_types');

const bufferAsHex = buffer => buffer.toString('hex');
const defaultFeeRate = 5000;
const defaultMaxAmount = 21e14;
const defaultMaxFeeForDeposit = 1337;
const defaultSwapAmount = 2500000;
const feeAsPpm = (fee, total) => Math.ceil(fee * 1e6 / total);
const findRecord = (r, type) => (r.find(n => n.type === type) || {}).value;
const {floor} = Math;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isInteger} = Number;
const isNumber = n => !isNaN(n) && !isNaN(parseFloat(n));
const makeSecret = () => randomBytes(32);
const maxDeposit = 31000;
const minAmount = 10000;
const minRate = 0;
const mtokensAsTokens = n => Number(BigInt(n) / BigInt(1e3));
const pushSwapRequestMaxFee = 10;
const pushSwapRequestTokens = 10;
const rateDenominator = 1e6;
const rateForFee = (tokens, fee) => fee * 1e6 / tokens;
const sha256 = preimage => createHash('sha256').update(preimage).digest();
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const typeKeySendPreimage = '5482373484';
const typeKeySendTrade = '805805';
const typeSwapResponse = serviceTypes.serviceTypeSwapResponse;

/** Request a swap out

  {
    ask: <Ask Function>
    [fund_routing_fee_rate]: <Fund with Maximum Routing Fee Rate Number>
    [is_avoiding_broadcast]: <Avoid Broadcasting Bool>
    [is_external_funding]: <Externally Fund Swap Bool>
    [is_loop_service]: <Use Lightning Loop Service Bool>
    [is_uncooperative]: <Avoid Cooperative Resolution Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [min_confirmations]: <Minimum Confirmations to Wait Number>
    [push_to]: <Push Swap Request to Node with Identity Public Key Hex String>
    [request]: <Request Function>
    [swap_recovery]: <Off to On Swap Recovery Hex String>
    [swap_request]: <Off to On Swap Request Hex String>
    [swap_response]: <Off to On Swap Response Hex String>
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

      // Get the swap service API for a LOOP swap
      getLoopTerms: ['getNetwork', ({getNetwork}, cbk) => {
        if (!args.is_loop_service) {
          return cbk(null, {});
        }

        const {network} = getNetwork;

        return getSwapOutTerms({
          metadata: lightningLabsSwapAuth({}).metadata,
          service: lightningLabsSwapService({network}).service,
        },
        cbk);
      }],

      // Ask for amount
      askForTokens: ['getLoopTerms', ({getLoopTerms}, cbk) => {
        // Exit early when tokens is predetermined
        if (!!args.swap_request) {
          const {tokens} = decodeOffToOnRequest({request: args.swap_request});

          return cbk(null, tokens);
        }

        const maxAmount = getLoopTerms.max_tokens || defaultMaxAmount;

        return args.ask({
          default: getLoopTerms.min_tokens || defaultSwapAmount,
          message: 'Amount to swap?',
          name: 'tokens',
          validate: input => {
            if (!isNumber(input)) {
              return false;
            }

            if (!isInteger(Number(input))) {
              return 'A whole number amount is expected';
            }

            if (Number(input) < minAmount) {
              return `A larger amount is required, minimum: ${minAmount}`;
            }

            if (Number(input) > maxAmount) {
              return `A smaller amount is required, maximum ${maxAmount}`;
            }

            return true;
          },
        },
        ({tokens}) => cbk(null, Number(tokens)));
      }],

      // Ask for routing fee rate
      askForRate: ['askForTokens', ({}, cbk) => {
        // Exit early when fee rate is predetermined
        if (args.fund_routing_fee_rate !== undefined) {
          return cbk(null, args.fund_routing_fee_rate);
        }

        // Exit early when there is no internal routing
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

      // Make a swap request
      makeRequest: ['askForRate', 'askForTokens', ({askForTokens}, cbk) => {
        if (!!args.swap_recovery && !!args.swap_request) {
          return cbk(null, {
            recovery: args.swap_recovery,
            request: args.swap_request,
          });
        }

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

      // Send a request to Lightning Loop service
      loopRequest: [
        'getNetwork',
        'makeRequest',
        ({getNetwork, makeRequest}, cbk) =>
      {
        // Exit early when not pushing a request
        if (!args.is_loop_service) {
          return cbk();
        }

        // Exit early when the request was already made
        if (!!args.swap_response) {
          return cbk();
        }

        return requestLoopOut({
          lnd: args.lnd,
          recovery: makeRequest.recovery,
        },
        cbk);
      }],

      // Push the request to the destination when doing a KeySend pushed swap
      pushRequest: [
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

      // Wait for a response of KeySend pushed swap request
      getResponse: [
        'getNetwork',
        'listenForResponse',
        'loopRequest',
        'makeRequest',
        ({getNetwork, listenForResponse, loopRequest, makeRequest}, cbk) =>
      {
        // Exit early when there is already a swap response
        if (!!args.swap_response) {
          return cbk(null, args.swap_response);
        }

        // Exit early when there is a p2p request
        if (!!listenForResponse) {
          return cbk(null, listenForResponse);
        }

        // Exit early when there is a Lightning Loop request
        if (!!loopRequest) {
          return cbk(null, loopRequest.response);
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

      // Decode the response details
      response: [
        'askForTokens',
        'getNetwork',
        'getResponse',
        'loopRequest',
        ({askForTokens, getNetwork, getResponse, loopRequest}, cbk) =>
      {
        // Exit early when the request is to Lightning Loop
        if (!!args.is_loop_service) {
          const details = decodeLoopResponse({
            network: getNetwork.bitcoinjs,
            response: getResponse,
          });

          const fee = details.fund_tokens - askForTokens;
          const noShow = tokensAsBigUnit(details.deposit_tokens);

          const totalCost = tokensAsBigUnit(details.deposit_tokens + fee);

          return cbk(null, {
            fee,
            deposit: details.deposit_tokens,
            pricing: `Service fee ${totalCost}, no-show penalty ${noShow}`,
            rate: rateForFee(askForTokens, fee),
            timeout: details.timeout,
          });
        }

        const response = decodeOffToOnResponse({
          network: getNetwork.bitcoinjs,
          response: getResponse,
        });

        const {tokens} = parsePaymentRequest({request: response.request});

        const deposit = mtokensAsTokens(response.deposit_mtokens);

        const combinedFee = tokens - askForTokens + deposit;
        const serviceFee = tokensAsBigUnit(deposit);
        const totalFee = tokensAsBigUnit(tokens - askForTokens + deposit);

        const ppmTotal = feeAsPpm(combinedFee, askForTokens);

        const feeInfo = `total fee is ${totalFee}, est PPM ${ppmTotal}`

        return cbk(null, {
          deposit,
          fee: tokens - askForTokens,
          incoming_peer: response.incoming_peer,
          pricing: `Execution cost ${serviceFee}, ${feeInfo}`,
          rate: rateForFee(askForTokens, deposit + (tokens - askForTokens)),
          timeout: response.timeout,
        });
      }],

      // Confirm the swap details
      okSwap: [
        'askForRate',
        'getResponse',
        'makeRequest',
        'response',
        ({askForRate, getResponse, makeRequest, response}, cbk) =>
      {
        const isExternal = !!args.is_external_funding;
        const isLowDeposit = response.deposit < maxDeposit;

        const isInLimited = !!response.incoming_peer;
        const timeout = `that times out at ${response.timeout}`;

        const inPeer = isExternal && isInLimited ? ` in via ${inbound}` : '';

        const {restart} = encodeOffToOnRestart({
          is_avoiding_broadcast: args.is_avoiding_broadcast,
          is_external_funding: args.is_external_funding,
          is_loop_service: args.is_loop_service,
          is_uncooperative: args.is_uncooperative,
          max_deposit_fee: defaultMaxFeeForDeposit,
          max_fund_fee_rate: askForRate,
          min_confirmations: args.min_confirmations,
          recovery: makeRequest.recovery,
          request: makeRequest.request,
          response: getResponse,
          sweep_address: args.sweep_address,
        });

        args.logger.info({recovery: restart});

        return args.ask({
          default: true,
          message: `Start swap ${timeout}? ${response.pricing}${inPeer}?`,
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
          is_loop_service: args.is_loop_service,
          is_uncooperative: args.is_uncooperative,
          lnd: args.lnd,
          max_fee_deposit: defaultMaxFeeForDeposit,
          max_fee_funding: floor(askForTokens * askForRate / rateDenominator),
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
