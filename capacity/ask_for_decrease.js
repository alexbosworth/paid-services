const {address} = require('bitcoinjs-lib');
const asyncAuto = require('async/auto');
const {createChainAddress} = require('ln-service');
const {getIdentity} = require('ln-service');
const {acceptsChannelOpen} = require('ln-sync');
const {getNetwork} = require('ln-sync');
const {networks} = require('bitcoinjs-lib');
const {returnResult} = require('asyncjs-util');

const proposeChannelOpen = require('./propose_channel_open');

const askForChanSize = max => `Capacity of the new channel? (max: ${max})`;
const askForSendSize = max => `Amount you want to send out? (max: ${max})`;
const bufferAsHex = buffer => buffer.toString('hex');
const dust = 550;
const {isInteger} = Number;
const isNumber = n => !isNaN(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const minChannelCapacity = 20000;
const minSpendTokens = 0;
const openChannelAction = 'open_channel';
const spendToExternalAddressAction = 'external_spend_funds';
const spendToInternalAddressAction = 'internal_spend_funds';
const {toOutputScript} = address;
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);

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
    [node]: <Create Channel with Node With Public Key Hex String>
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

      // Select the type of decrease
      askForDecreaseType: ['validate', ({}, cbk) => {
        return ask({
          choices: [
            {
              name: `Send decreased funds to the internal chain wallet`,
              value: spendToInternalAddressAction,
            },
            {
              name: `Send decreased funds to an external chain address`,
              value: spendToExternalAddressAction,
            },
            {
              disabled: max < minChannelCapacity,
              name: `Spend decreased funds into new channel with another peer`,
              value: openChannelAction,
            },
          ],
          message: 'How do you want to change the channel capacity?',
          name: 'decrease',
          type: 'list',
        },
        ({decrease}) => cbk(null, decrease));
      }],

      // Get the node identity key to make sure a channel open isn't with self
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd}, cbk)],

      // Get network name to validate addresses against
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Ask for the public key of the node to trade with
      askForNodeId: [
        'askForDecreaseType',
        'getIdentity',
        ({askForDecreaseType, getIdentity}, cbk) =>
      {
        // Exit early when not opening a new channel
        if (askForDecreaseType !== openChannelAction) {
          return cbk();
        }

        return ask({
          name: 'key',
          message: 'Public key of node to open channel with?',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
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
        ({key}) => cbk(null, key));
      }],

      // Create a decrease address to withdraw funds out to
      createAddress: ['askForDecreaseType', ({askForDecreaseType}, cbk) => {
        // Exit early when there is no need to create an internal address
        if (askForDecreaseType !== spendToInternalAddressAction) {
          return cbk();
        }

        return createChainAddress({lnd}, cbk);
      }],

      // Ask for the amount to decrease
      askForAmount: ['askForNodeId', ({askForNodeId}, cbk) => {
        return ask({
          default: !askForNodeId ? minSpendTokens : minChannelCapacity,
          message: !askForNodeId ? askForSendSize(max) : askForChanSize(max),
          name: 'amount',
          validate: input => {
            // A numeric input is required
            if (!isNumber(input) || !isInteger(Number(input))) {
              return false;
            }

            // Zero value is acceptable for a decrease when not opening channel
            if (!askForNodeId && !Number(input)) {
              return true;
            }

            // On-chain values must always be above dust
            if (!!Number(input) && Number(input) < dust) {
              return false;
            }

            // Channel opens must always be above the minimum channel size
            if (!!askForNodeId && Number(input) < minChannelCapacity) {
              return `The minimum channel capacity is ${minChannelCapacity}`;
            }

            // A decrease cannot spend more funds than are available
            if (!!Number(input) && Number(input) > max) {
              return `The maximum possible to decrease is ${max}`;
            }

            return true;
          },
        },
        ({amount}) => cbk(null, Number(amount)));
      }],

      // Ask for an external address
      askForAddress: [
        'askForAmount',
        'askForDecreaseType',
        'getNetwork',
        ({askForAmount, askForDecreaseType, getNetwork}, cbk) =>
      {
        // Exit early when the withdraw address is not external
        if (askForDecreaseType !== spendToExternalAddressAction) {
          return cbk();
        }

        return ask({
          name: 'address',
          message: `Address to spend ${tokensAsBigUnit(askForAmount)} to?`,
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            // Make sure that the entered address can be derived to an output
            try {
              toOutputScript(input, networks[getNetwork.bitcoinjs]);
            } catch (err) {
              return 'Failed to parse address. Try a standard one?';
            }

            return true;
          },
        },
        ({address}) => cbk(null, {address}));
      }],

      // Ask if this is the last output
      askForAddition: [
        'askForAddress',
        'askForAmount',
        'askForDecreaseType',
        ({askForAmount, askForDecreaseType}, cbk) =>
      {
        // Exit early and only ask for addition when decrease is a "spend" type
        if (askForDecreaseType === spendToInternalAddressAction) {
          return cbk();
        }

        // Exit early when there are no more funds to spend
        if (max - askForAmount < dust) {
          return cbk();
        }

        return ask({
          default: false,
          name: 'add',
          message: 'Spend additional funds from the channel capacity?',
          type: 'confirm',
        },
        ({add}) => cbk(null, add));
      }],

      // Propose a channel open to confirm the peer will accept the channel
      checkChannelAcceptance: [
        'askForAmount',
        'askForNodeId',
        ({askForAmount, askForNodeId}, cbk) =>
      {
        // Exit early if pubkey was not entered
        if (!askForNodeId) {
          return cbk();
        }

        return proposeChannelOpen({
          lnd,
          capacity: askForAmount,
          id: askForNodeId,
        },
        cbk);
      }],

      // Final decrease output details
      decrease: [
        'askForAddition',
        'askForAddress',
        'askForAmount',
        'checkChannelAcceptance',
        'createAddress',
        'getNetwork',
        ({
          askForAddition,
          askForAddress,
          askForAmount,
          askForNodeId,
          checkChannelAcceptance,
          createAddress,
          getNetwork,
        },
        cbk) =>
      {
        // Make sure that a channel proposal didn't fail
        if (!!checkChannelAcceptance && !checkChannelAcceptance.is_accepted) {
          return cbk([503, 'RemoteNodeRejectedNewChannelProposal']);
        }

        // Exit early when decreasing to a new channel
        if (!!askForNodeId) {
          return cbk(null, {
            is_final: !askForAddition,
            node: askForNodeId,
            tokens: askForAmount,
          });
        }

        const {address} = (createAddress || askForAddress);

        const output = toOutputScript(address, networks[getNetwork.bitcoinjs]);

        return cbk(null, {
          address,
          is_final: !askForAddition,
          output: bufferAsHex(output),
          tokens: askForAmount,
        });
      }],
    },
    returnResult({reject, resolve, of: 'decrease'}, cbk));
  });
};
