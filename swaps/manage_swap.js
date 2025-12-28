const {address} = require('bitcoinjs-lib');
const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {findKey} = require('ln-sync');
const {getMasterPublicKeys} = require('ln-service');
const {getAllInvoices} = require('ln-sync');
const {getInvoice} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNodeAlias} = require('ln-sync');
const {networks} = require('bitcoinjs-lib');
const {returnResult} = require('asyncjs-util');

const decodeOffToOnRequest = require('./decode_off_to_on_request');
const decodeOffToOnRestart = require('./decode_off_to_on_restart');
const {decodeTrade} = require('./../trades');
const outputScriptForAddress = require('./output_script_for_address');
const recoverResponseToSwapOut = require('./recover_response_to_swap_out');
const requestSwapOut = require('./request_swap_out');
const respondToSwapOutRequest = require('./respond_to_swap_out_request');

const actionLoopRequest = 'loop-request';
const actionPushRequest = 'push-request';
const actionRestartRequest = 'restart-request';
const allowedNetwork = 'btctestnet';
const bip86Path = `m/86'/0'/0'`;
const flatten = arr => [].concat(...arr);
const minConfirmations = {btc: 2, btcregtest: 3, btctestnet: 1};
const niceId = id => id.substring(0, 8);
const niceName = node => `${node.alias} ${node.id.substring(0, 8)}`.trim();
const pushesReceivedAfter = () => new Date(Date.now() - 1000 * 60 * 60 * 24);
const recoverRespondAction = 'recover-response';
const requestAction = 'request';
const respondAction = 'respond';
const {toOutputScript} = address;
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const typeKeySendTrade = '805805';

/** Manage a swap

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToManageSwap']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToManageSwap']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToManageSwap']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToManageSwap']);
        }

        return cbk();
      },

      // Get invoices to find past swap requests
      getInvoices: ['validate', ({}, cbk) => {
        return getAllInvoices({
          created_after: pushesReceivedAfter().toISOString(),
          lnd: args.lnd,
        },
        cbk);
      }],

      // Look for a p2tr master public key to detect p2tr support
      getMasterPublicKeys: ['validate', ({}, cbk) => {
        return getMasterPublicKeys({lnd: args.lnd}, cbk);
      }],

      // Get the network to make sure this is on testnet
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Received swap pushes
      swapPushes: ['getInvoices', ({getInvoices}, cbk) => {
        const pushes = getInvoices.invoices.map(invoice => {
          // A swap push is a KeySend payment
          if (!invoice.is_confirmed || !invoice.is_push) {
            return;
          }

          const messages = flatten(invoice.payments.map(n => n.messages));

          // Convert messages to swaps
          const swaps = messages.map(message => {
            // Swaps have the trade type wrapper
            if (message.type !== typeKeySendTrade) {
              return;
            }

            // The trade type should be a swap
            try {
              const {swap} = decodeTrade({trade: message.value});

              if (!swap) {
                return;
              }

              const details = decodeOffToOnRequest({request: swap.request});

              // Return relevant swap details for acceptance
              return {
                confirmed_at: invoice.confirmed_at,
                id: details.hash,
                tokens: details.tokens,
                node: swap.node,
                trade: message.value,
              };
            } catch (err) {
              return;
            }
          });

          const [swap] = swaps.filter(n => !!n);

          return swap;
        });

        return cbk(null, pushes.filter(n => !!n));
      }],

      // Get node aliases for pushes
      getAliases: ['swapPushes', ({swapPushes}, cbk) => {
        return asyncMap(swapPushes, ({node}, cbk) => {
          return getNodeAlias({id: node, lnd: args.lnd}, cbk);
        },
        cbk);
      }],

      // Get existing swaps
      getExisting: ['swapPushes', ({swapPushes}, cbk) => {
        return asyncMap(swapPushes, ({id}, cbk) => {
          return getInvoice({id, lnd: args.lnd}, (err, res) => {
            // Error indicates that the invoice could not be looked up
            if (!!err) {
              return cbk();
            }

            // Result indicates the invoice is known so the swap is in progress
            return cbk(null, id);
          });
        },
        cbk);
      }],

      // Determine if taproot is supported or not
      hasTr: ['getMasterPublicKeys', ({getMasterPublicKeys}, cbk) => {
        const {keys} = getMasterPublicKeys;

        return cbk(null, !!keys.find(n => n.derivation_path === bip86Path));
      }],

      // Select a swap action
      selectAction: [
        'getAliases',
        'getExisting',
        'getNetwork',
        'hasTr',
        'swapPushes',
        ({getAliases, getExisting, getNetwork, hasTr, swapPushes}, cbk) =>
      {
        // Check to make sure the network is supported
        if (!hasTr && getNetwork.network !== allowedNetwork) {
          return cbk([501, 'CurrentlyUnsupportedChainForSwap']);
        }

        const pushes = swapPushes
          .filter(push => !getExisting.includes(push.id))
          .map(push => {
            const amount = tokensAsBigUnit(push.tokens);
            const id = niceId(push.id);
            const node = niceName(getAliases.find(n => n.id === push.node));

            return {
              name: `Accept request ${id} to swap ${amount} with ${node}`,
              value: push.trade,
            };
          });

        const choices = [
          {
            name: 'Make a new swap request',
            value: requestAction,
          },
          {
            name: 'Send a new swap request via KeySend',
            value: actionPushRequest,
          },
          {
            name: 'Request a swap from Lightning Loop',
            value: actionLoopRequest,
          },
          {
            name: 'Respond to a swap request',
            value: respondAction,
          },
          {
            name: 'Recovery for swap request',
            value: actionRestartRequest,
          },
          {
            name: 'Recovery for swap response',
            value: recoverRespondAction,
          },
        ];

        return args.ask({
          choices: choices.concat(pushes),
          message: 'Off-chain to on-chain swap:',
          name: 'action',
          type: 'select',
        },
        ({action}) => cbk(null, action));
      }],

      // Ask for the remote to send to
      askForRemote: ['selectAction', ({selectAction}, cbk) => {
        // Exit early when the request is not KeySend
        if (selectAction !== actionPushRequest) {
          return cbk();
        }

        return args.ask({
          message: 'Node key or channel peer alias to send request to?',
          name: 'remote',
          validate: input => !!input,
        },
        ({remote}) => cbk(null, remote));
      }],

      // Ask for a request restart code
      askForRestart: ['selectAction', ({selectAction}, cbk) => {
        // Exit early when not restarting a swap request
        if (selectAction !== actionRestartRequest) {
          return cbk();
        }

        return args.ask({
          message: 'Restart recovery code?',
          name: 'restart',
          validate: input => !!input,
        },
        ({restart}) => cbk(null, restart));
      }],

      // Find the remote identity key when specified
      findKey: ['askForRemote', ({askForRemote}, cbk) => {
        if (!askForRemote) {
          return cbk(null, {});
        }

        return findKey({lnd: args.lnd, query: askForRemote}, cbk);
      }],

      // Ask if the offchain funding should be external
      askForExternal: [
        'askForRemote',
        'selectAction',
        ({selectAction}, cbk) =>
      {
        switch (selectAction) {
        case actionLoopRequest:
        case actionPushRequest:
        case requestAction:
          return args.ask({
            message: 'Use internal funds to pay offchain payment request?',
            name: 'internal',
            type: 'confirm',
          },
          ({internal}) => cbk(null, !internal));

        default:
          // External funding not supported
          return cbk();
        }
      }],

      // Ask if the sweep address should be custom
      askForSweepAddress: [
        'askForExternal',
        'getNetwork',
        'selectAction',
        ({getNetwork, selectAction}, cbk) =>
      {
        switch (selectAction) {
        case actionLoopRequest:
        case actionPushRequest:
        case requestAction:
          return args.ask({
            message: 'Send on-chain funds to an external address? (Optional)',
            name: 'sweep',
            type: 'input',
            validate: input => {
              if (!input) {
                return true;
              }

              try {
                return !!outputScriptForAddress({
                  address: input,
                  network: getNetwork.bitcoinjs,
                });
              } catch (err) {
                return 'Unsupported on-chain address format';
              }
            }
          },
          ({sweep}) => cbk(null, sweep));

        default:
          // Custom sweep address not supported
          return cbk();
        }
      }],

      // Make swap request
      makeRequest: [
        'askForExternal',
        'askForRemote',
        'askForRestart',
        'askForSweepAddress',
        'findKey',
        'getNetwork',
        'hasTr',
        'selectAction',
        ({
          askForExternal,
          askForRestart,
          askForRemote,
          askForSweepAddress,
          findKey,
          getNetwork,
          hasTr,
          selectAction,
        },
        cbk) =>
      {
        switch (selectAction) {
        case actionLoopRequest:
        case requestAction:
          break;

        case actionPushRequest:
          if (!findKey.public_key) {
            return cbk([400, 'UnknownNodeToPushSwapRequestTo']);
          }
          break;

        case actionRestartRequest:
          const restart = decodeOffToOnRestart({restart: askForRestart});

          return requestSwapOut({
            ask: args.ask,
            fund_routing_fee_rate: restart.max_fund_fee_rate,
            is_external_funding: restart.is_external_funding,
            is_loop_service: restart.is_loop_service,
            lnd: args.lnd,
            logger: args.logger,
            min_confirmations: restart.min_confirmations,
            request: !hasTr ? args.request : undefined,
            swap_recovery: restart.recovery,
            swap_request: restart.request,
            swap_response: restart.response,
            sweep_address: restart.sweep_address,
          },
          cbk);

        default:
          return cbk();
        }

        return requestSwapOut({
          ask: args.ask,
          is_external_funding: askForExternal,
          is_loop_service: selectAction === actionLoopRequest,
          lnd: args.lnd,
          logger: args.logger,
          push_to: findKey.public_key,
          min_confirmations: minConfirmations[getNetwork.network],
          request: !hasTr ? args.request : undefined,
          sweep_address: askForSweepAddress || undefined,
        },
        cbk);
      }],

      // Make a response for a swap request
      makeResponse: ['hasTr', 'selectAction', ({hasTr, selectAction}, cbk) => {
        if (selectAction !== respondAction) {
          return cbk();
        }

        return respondToSwapOutRequest({
          ask: args.ask,
          is_external_funding: true,
          lnd: args.lnd,
          logger: args.logger,
          request: !hasTr ? args.request : undefined,
        },
        cbk);
      }],

      // Respond to a pushed swap request
      respondToPush: [
        'hasTr',
        'selectAction',
        ({hasTr, selectAction}, cbk) =>
      {
        // Exit early when not responding to a push
        try {
          decodeTrade({trade: selectAction});
        } catch (err) {
          return cbk();
        }

        const {swap} = decodeTrade({trade: selectAction});

        return respondToSwapOutRequest({
          ask: args.ask,
          lnd: args.lnd,
          logger: args.logger,
          request: !hasTr ? args.request : undefined,
          swap: swap.request,
          to: swap.node,
        },
        cbk);
      }],

      // Recover responding to swap request
      recoverResponse: [
        'hasTr',
        'selectAction',
        ({hasTr, selectAction}, cbk) =>
      {
        // Exit early when not recovering on the response side
        if (selectAction !== recoverRespondAction) {
          return cbk();
        }

        return recoverResponseToSwapOut({
          ask: args.ask,
          lnd: args.lnd,
          logger: args.logger,
          request: !hasTr ? args.request : undefined,
        },
        cbk);
      }],

      // Final result
      result: [
        'makeRequest',
        'makeResponse',
        'recoverResponse',
        'respondToPush',
        ({makeRequest, makeResponse, recoverResponse, respondToPush}, cbk) =>
      {
        if (!!makeRequest) {
          return cbk(null, makeRequest);
        }

        if (!!makeResponse) {
          return cbk(null, makeResponse);
        }

        if (!!recoverResponse) {
          return cbk(null, recoverResponse);
        }

        if (!!respondToPush) {
          return cbk(null, respondToPush);
        }

        return cbk();
      }],
    },
    returnResult({reject, resolve, of: 'result'}, cbk));
  });
};
