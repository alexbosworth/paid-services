const asyncAuto = require('async/auto');
const {getMasterPublicKeys} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const recoverResponseToSwapOut = require('./recover_response_to_swap_out');
const requestSwapOut = require('./request_swap_out');
const respondToSwapOutRequest = require('./respond_to_swap_out_request');

const allowedNetwork = 'btctestnet';
const bip86Path = `m/86'/0'/0'`;
const minConfirmations = {btc: 2, btcregtest: 3, btctestnet: 1};
const recoverRespondAction = 'recover-response';
const requestAction = 'request';
const respondAction = 'respond';

/** Manage a swap

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({ask, lnd, logger, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToManageSwap']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToManageSwap']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToManageSwap']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToManageSwap']);
        }

        return cbk();
      },

      // Look for a p2tr master public key to detect p2tr support
      getMasterPublicKeys: ['validate', ({}, cbk) => {
        return getMasterPublicKeys({lnd}, cbk);
      }],

      // Get the network to make sure this is on testnet
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Determine if taproot is supported or not
      hasTr: ['getMasterPublicKeys', ({getMasterPublicKeys}, cbk) => {
        const {keys} = getMasterPublicKeys;

        return cbk(null, !!keys.find(n => n.derivation_path === bip86Path));
      }],

      // Select a swap action
      selectAction: ['getNetwork', 'hasTr', ({getNetwork, hasTr}, cbk) => {
        // Check to make sure the network is supported
        if (!hasTr && getNetwork.network !== allowedNetwork) {
          return cbk([501, 'CurrentlyUnsupportedChainForSwap']);
        }

        return ask({
          choices: [
            {
              name: 'Make a new swap request',
              value: requestAction,
            },
            {
              name: 'Respond to a swap request',
              value: respondAction,
            },
            {
              name: 'Recovery for swap response',
              value: recoverRespondAction,
            },
          ],
          message: 'Off-chain to on-chain swap:',
          name: 'action',
          type: 'list',
        },
        ({action}) => cbk(null, action));
      }],

      // Make swap request
      makeRequest: ['hasTr', 'selectAction', ({hasTr, selectAction}, cbk) => {
        if (selectAction !== requestAction) {
          return cbk();
        }

        return requestSwapOut({
          ask,
          lnd,
          logger,
          min_confirmations: minConfirmations[getNetwork.network],
          request: !hasTr ? request : undefined,
        },
        cbk);
      }],

      // Respond to swap request
      makeResponse: ['hasTr', 'selectAction', ({hasTr, selectAction}, cbk) => {
        if (selectAction !== respondAction) {
          return cbk();
        }

        return respondToSwapOutRequest({
          ask,
          lnd,
          logger,
          request: !hasTr ? request : undefined,
        },
        cbk);
      }],

      // Recover responding to swap request
      recoverResponse: [
        'hasTr',
        'selectAction',
        ({hasTr, selectAction}, cbk) =>
      {
        if (selectAction !== recoverRespondAction) {
          return cbk();
        }

        return recoverResponseToSwapOut({
          ask,
          lnd,
          logger,
          request: !hasTr ? request : undefined,
        },
        cbk);
      }],

      // Final result
      result: [
        'makeRequest',
        'makeResponse',
        'recoverResponse',
        ({makeRequest, makeResponse, recoverResponse}, cbk) =>
      {
        return cbk(null, makeRequest || makeResponse || recoverResponse);
      }],
    },
    returnResult({reject, resolve, of: 'result'}, cbk));
  });
};
