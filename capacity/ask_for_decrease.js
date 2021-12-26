const {address} = require('bitcoinjs-lib');
const asyncAuto = require('async/auto');
const {createChainAddress} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {networks} = require('bitcoinjs-lib');
const {returnResult} = require('asyncjs-util');

const bufferAsHex = buffer => buffer.toString('hex');
const dust = 550;
const isNumber = n => !isNaN(n);
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

      // Ask if withdrawing to an external address
      askForExternal: ['askForAmount', ({askForAmount}, cbk) => {
        if (!Number(askForAmount)) {
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
        ({askForExternal}, cbk) =>
      {
        // Exit early when the spend was to an internal addess
        if (!askForExternal) {
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
      createAddress: ['askForExternal', ({askForExternal}, cbk) => {
        // Exit early when the withdraw address is external
        if (askForExternal !== false) {
          return cbk();
        }

        return createChainAddress({lnd}, cbk);
      }],

      // Final decrease output details
      decrease: [
        'askForAddition',
        'askForAddress',
        'askForAmount',
        'createAddress',
        'getNetwork',
        ({
          askForAddition,
          askForAddress,
          askForAmount,
          createAddress,
          getNetwork,
        },
        cbk) =>
      {
        const {address} = (createAddress || askForAddress || {});

        // Exit early when not decreasing to an address
        if (!address) {
          return cbk(null, {is_final: true, tokens: Number(askForAmount)});
        }

        // Make sure the address is valid
        try {
          toOutputScript(address, networks[getNetwork.bitcoinjs]);
        } catch (err) {
          return cbk([400, 'FailedToParseAddress', {err}]);
        }

        const output = toOutputScript(address, networks[getNetwork.bitcoinjs]);

        return cbk(null, {
          address,
          is_final: !askForAddition,
          output: bufferAsHex(output),
          tokens: Number(askForAmount),
        });
      }],
    },
    returnResult({reject, resolve, of: 'decrease'}, cbk));
  });
};
