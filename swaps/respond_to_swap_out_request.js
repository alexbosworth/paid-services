const {createHash} = require('crypto');
const EventEmitter = require('events');

const asyncAuto = require('async/auto');
const {findKey} = require('ln-sync');
const {getChainFeeRate} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const completeOnToOffSwap = require('./complete_on_to_off_swap');
const {connectPeer} = require('ln-sync');
const decodeOffToOnRequest = require('./decode_off_to_on_request');
const {makePeerRequest} = require('./../p2p');
const serviceTypes = require('./../service_types');
const startOnToOffSwap = require('./start_on_to_off_swap');

const bufferAsHex = buffer => buffer.toString('hex');
const {ceil} = Math;
const defaultConfirmationTarget = 6;
const {floor} = Math;
const defaultCltvDelta = 400;
const defaultFeeRate = 2500;
const estimatedVirtualSize = 300;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isNumber = n => !isNaN(n) && !isNaN(parseFloat(n));
const maxTarget = 144;
const minRate = 1;
const minTarget = 2;
const peerRequestTimeoutMs = 1000 * 60 * 3;
const rateDenominator = 1e6;
const sha256 = preimage => createHash('sha256').update(preimage).digest();
const typeSwapId = '0';
const typeSwapReply = '1';
const typeSwapResponse = serviceTypes.serviceTypeSwapResponse;

/** Respond to a swap out request

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [request]: <Request Function>
    [swap]: <Swap Hex String>
    [to]: <Send Swap Response To Public Key Id Hex String>
  }

  @returns via cbk or Promise
*/
module.exports = ({ask, lnd, logger, request, swap, to}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToRespondToSwapOutRequest']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRespondToSwapOutReq']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToRespondToSwapOutRequest']);
        }

        if (!!swap) {
          try {
            decodeOffToOnRequest({request: swap});
          } catch (err) {
            return cbk([400, err.message]);
          }
        }

        return cbk();
      },

      // Ask for a request
      askForRequest: ['validate', ({}, cbk) => {
        // Exit early when a swap request is defined
        if (!!swap) {
          return cbk(null, swap);
        }

        return ask({
          message: 'Swap request?',
          name: 'req',
          validate: input => {
            if (!input) {
              return;
            }

            try {
              decodeOffToOnRequest({request: input});
            } catch (err) {
              return 'Failed parse this request, check input?';
            }

            return true;
          },
        },
        ({req}) => cbk(null, req));
      }],

      // Connect to the peer when a swap is pushed
      connect: ['validate', ({}, cbk) => {
        if (!to) {
          return cbk();
        }

        return connectPeer({lnd, id: to}, cbk);
      }],

      // Ask for pricing
      askForRate: ['askForRequest', ({askForRequest}, cbk) => {
        const {tokens} = decodeOffToOnRequest({request: askForRequest});

        logger.info({swap_amount: tokens});

        return ask({
          default: defaultFeeRate,
          message: 'Price fee rate for swap in parts per million?',
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

      // Ask for chain fee target
      askForTarget: ['askForRate', ({}, cbk) => {
        return ask({
          default: defaultConfirmationTarget,
          message: 'Confirm on-chain funding within how many blocks?',
          name: 'target',
          validate: input => {
            if (!isNumber(input)) {
              return false;
            }

            if (Number(input) > maxTarget) {
              return `A smaller number is required, maximum: ${maxTarget}`;
            }

            if (Number(input) < minTarget) {
              return `A larger number is required, minimum: ${minTarget}`;
            }

            return true;
          },
        },
        ({target}) => cbk(null, Number(target)));
      }],

      // Ask for an incoming peer to constrain the swap to
      askForIncoming: ['askForTarget', ({}, cbk) => {
        return ask({
          message: 'Require off-chain through a specific peer? (Optional)',
          name: 'incoming',
        },
        ({incoming}) => cbk(null, incoming));
      }],

      // Find the incoming identity key when specified
      findIncoming: ['askForIncoming', ({askForIncoming}, cbk) => {
        if (!askForIncoming) {
          return cbk(null, {});
        }

        return findKey({lnd, query: askForIncoming}, cbk);
      }],

      // Get the chain fee rate
      getRate: ['askForTarget', ({askForTarget}, cbk) => {
        return getChainFeeRate({lnd, confirmation_target: askForTarget}, cbk);
      }],

      // Make a response
      makeResponse: [
        'askForRate',
        'askForRequest',
        'findIncoming',
        'getRate',
        ({askForRate, askForRequest, findIncoming, getRate}, cbk) =>
      {
        const {tokens} = decodeOffToOnRequest({request: askForRequest});

        if (!!findIncoming.public_key) {
          logger.info({incoming_peer_constraint: findIncoming.public_key});
        }

        return startOnToOffSwap({
          lnd,
          delta: defaultCltvDelta,
          deposit: ceil(getRate.tokens_per_vbyte * estimatedVirtualSize),
          incoming_peer: findIncoming.public_key || undefined,
          is_external_solo_key: !!request,
          price: floor(tokens * askForRate / rateDenominator),
          request: askForRequest,
        },
        cbk);
      }],

      // Complete the swap
      completeSwap: [
        'askForTarget',
        'makeResponse',
        ({askForTarget, makeResponse}, cbk) =>
      {
        logger.info({
          recovery: makeResponse.recovery,
          response: !to ? makeResponse.response : undefined,
        });

        const emitter = new EventEmitter();

        emitter.on('update', update => logger.info(update));

        return completeOnToOffSwap({
          emitter,
          lnd,
          request,
          confirmation_target: askForTarget,
          recovery: makeResponse.recovery,
        },
        cbk);
      }],

      // Send swap response over p2p so the peer can start the payment
      sendResponse: ['connect', 'makeResponse', ({makeResponse}, cbk) => {
        // Exit early when a swap response destination is not defined
        if (!swap || !to) {
          return cbk();
        }

        return makePeerRequest({
          lnd,
          to,
          records: [
            {type: typeSwapId, value: bufferAsHex(sha256(hexAsBuffer(swap)))},
            {type: typeSwapReply, value: makeResponse.response},
          ],
          timeout: peerRequestTimeoutMs,
          type: typeSwapResponse,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'completeSwap'}, cbk));
  });
};
