const {address} = require('bitcoinjs-lib');
const asyncAuto = require('async/auto');
const {createChainAddress} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {acceptsChannelOpen} = require('ln-sync');
const {getNetwork} = require('ln-sync');
const {networks} = require('bitcoinjs-lib');
const {returnResult} = require('asyncjs-util');
const proposeChannelOpen = require('./propose_channel_open');

const bufferAsHex = buffer => buffer.toString('hex');
const dust = 550;
const isNumber = n => !isNaN(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const minChannelCapacity = 20000;
const {toOutputScript} = address;


/** Ask for details about a decrease

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    max: <Maximum Possible Decrease Number>
  }

  @returns via cbk or Promise
  {
    [address]: <Send Funds to Address String>
    is_final: <Decrease is Final Decrease Bool>
    [output]: <Output Script Hex String>
    tokens: <Withdraw Tokens Number>
  }
*/
module.exports = ({ask, lnd, max}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToAskForDecrease']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToAskForDecrease']);
        }

        if (!max) {
          return cbk([400, 'ExpectedMaximumAvaialbleTok'])
        }

        return cbk();
      },

      // Ask for the amount to decrease
      askForAmount: ['validate', ({}, cbk) => {
        return ask({
          default: '0',
          name: 'amount',
          message: `How much do you want to spend out (max: ${max})?`,
          type: 'input',
          validate: input => {
            if (!isNumber(input) || !Number.isInteger(Number(input))) {
              return false;
            }

            if (!!Number(input) && Number(input) < dust) {
              return false;
            }

            if (!!Number(input) && Number(input) > max) {
              return `The maximum possible to decrease is ${max}`;
            }

            return true;
          },
        },
        ({amount}) => cbk(null, amount));
      }],

      // Get network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      //Ask for public key to open channel with

      // Get the node identity key
      getIdentity: ['validate', ({}, cbk) => getWalletInfo({lnd}, cbk)],

      // Ask for the public key of the node to trade with
      askForNodeId: ['getIdentity','askForAmount', ({getIdentity, askForAmount}, cbk) => {

        //Exit early if no decrease amount or amount is too low to open a channel
        if(!askForAmount || askForAmount < minChannelCapacity) {
          return cbk();
        }

        return ask({
          name: 'query',
          message: `Public key of node to open channel with for ${askForAmount}? (optional)`,
          type: 'input',
          validate: input => {
            if(!input) {
              return true;
            }

            if (!isPublicKey(input)) {
              return 'Expected public key of node to open channel with';
            }

            if (input === getIdentity.public_key) {
              return 'Expected public key of other node';
            }

            return true;
          },
        },
        ({query}) => cbk(null, query));
      }],

      // Ask if withdrawing to an external address
      askForExternal: [
        'askForAmount',
        'askForNodeId',
        ({askForAmount, askForNodeId}, cbk) => {
          //Exit early if there is a pubkey to open channel with
        if (!Number(askForAmount) || !!askForNodeId) {
          return cbk();
        }
        return ask({
          default: false,
          name: 'spend',
          message: `Spend ${askForAmount} to an external address?`,
          type: 'confirm',
        },
        ({spend}) => cbk(null, spend));
      }],

      // Ask for an external address
      askForAddress: [
        'askForAmount',
        'askForExternal',
        'askForNodeId',
        ({askForAmount, askForExternal}, cbk) =>
      {
        // Exit early when the withdraw address is internal
        if (askForExternal !== true) {
          return cbk();
        }

        return ask({
          name: 'address',
          message: `Address to spend ${askForAmount} to?`,
          type: 'input',
          validate: input => !!input,
        },
        ({address}) => cbk(null, {address}));
      }],

      // Ask if this is the last output
      askForAddition: [
        'askForAddress',
        'askForExternal',
        ({askForExternal, askForNodeId}, cbk) =>
      {
        // Exit early when the spend was to an internal addess or a 2nd node ID
        if (!askForExternal || !!askForNodeId) {
          return cbk();
        }

        return ask({
          default: false,
          name: 'add',
          message: 'Add another spend to a different address?',
          type: 'confirm',
        },
        ({add}) => cbk(null, add));
      }],

      // Create a decrease address to withdraw funds out to
      createAddress: ['askForExternal', ({askForExternal, askForNodeId}, cbk) => {
        // Exit early when the withdraw address is external or an external pubkey was entered
        if (askForExternal !== false || !!askForNodeId) {
          return cbk();
        }

        return createChainAddress({lnd}, cbk);
      }],

      //Propose channel open
      checkAccept: ['askForNodeId', ({askForAmount,askForNodeId}, cbk) => {
        //Exit early if pubkey was not entered
        if(!askForNodeId) {
          return cbk();
        }
        return proposeChannelOpen({
          lnd,
          public_key: askForNodeId,
          amount: askForAmount,
        },
        cbk);
      }],

      // Final decrease output details
      decrease: [
        'askForAddition',
        'askForAddress',
        'askForAmount',
        'checkAccept',
        'createAddress',
        'getNetwork',
        ({
          askForAddition,
          askForAddress,
          askForAmount,
          askForNodeId,
          checkAccept,
          createAddress,
          getNetwork,
        },
        cbk) =>
      {
        if(!!checkAccept && !checkAccept.is_accepted) {
          return cbk([400, 'ErrorTestingChannelOpenForNewPeer']);
        }

        const {address} = (createAddress || askForAddress || {});
        // Exit early when not decreasing to an address
        if (!address && !checkAccept) {
          return cbk(null, {is_final: true, tokens: Number(askForAmount)});
        }

        // Make sure the address is valid
      if(!!address) {
        try {
          toOutputScript(address, networks[getNetwork.bitcoinjs]);
        } catch (err) {
          return cbk([400, 'FailedToParseAddress', {err}]);
        }
      }

        const output = !!address ? toOutputScript(address, networks[getNetwork.bitcoinjs]) : undefined;

        return cbk(null, {
          address,
          is_final: !askForAddition,
          output: !!output ? bufferAsHex(output) : undefined,
          public_key: askForNodeId || undefined,
          tokens: Number(askForAmount),
        });
      }],
    },
    returnResult({reject, resolve, of: 'decrease'}, cbk));
  });
};
