const asyncAuto = require('async/auto');
const {getChainBalance} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const defaultChannelCapacity = 5e6;
const defaultGroupSize = 3;
const {floor} = Math;
const halfOf = input => Number(input) / 2;
const isNumber = n => !isNaN(n);
const isOdd = n => !!(n % 2);
const maxChannelSize = 21e14;
const minChannelSize = 2e4;
const maxGroupSize = 420;
const minGroupSize = 2;
const {round} = Math;

/** Ask for new group details to create a group

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    capacity: <Channel Capacity Tokens Number>
    count: <Group Members Number>
    rate: <Chain Fee Tokens Per VByte Number>
  }
*/
module.exports = ({ask, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToAskForGroupDetails']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToAskForGroupDetails']);
        }

        return cbk();
      },

      // Get the wallet balance to make sure there are enough funds to join
      getBalance: ['validate', ({}, cbk) => getChainBalance({lnd}, cbk)],

      // Get the chain fee rate to use for a default in the chain fee query
      getFeeRate: ['validate', ({}, cbk) => getChainFeeRate({lnd}, cbk)],

      // Ask for how many group members there should be
      askForCount: ['validate', ({}, cbk) => {
        return ask({
          default: defaultGroupSize,
          name: 'size',
          message: 'Total number of group members?',
          validate: input => {
            if (!input || !isNumber(input)) {
              return false;
            }

            // Do not allow fractional members
            if (round(Number(input)) !== Number(input)) {
              return false;
            }

            // Do not allow too many members
            if (Number(input) > maxGroupSize) {
              return `The maximum group size is ${maxGroupSize}`;
            }

            // Do not allow too few members
            if (Number(input) < minGroupSize) {
              return `The minimum group size is ${minGroupSize}`;
            }

            return true;
          },
        },
        ({size}) => cbk(null, Number(size)));
      }],

      // Ask for how big the channels should be
      askForCapacity: [
        'askForCount',
        'getBalance',
        ({askForCount, getBalance}, cbk) =>
      {
        const isPair = askForCount === minGroupSize;

        return ask({
          default: defaultChannelCapacity,
          name: 'capacity',
          message: 'Channel capacity?',
          validate: input => {
            if (!input || !isNumber(input)) {
              return false;
            }

            if (round(Number(input)) !== Number(input)) {
              return false;
            }

            if (!isPair && Number(input) > getBalance.chain_balance) {
              return `Current chain balance is ${getBalance.chain_balance}`;
            }

            if (isPair && halfOf(input) > getBalance.chain_balance) {
              return `Current chain balance is ${getBalance.chain_balance}`;
            }

            if (Number(input) < minChannelSize) {
              return `Minimum channel size is ${minChannelSize}`;
            }

            if (isOdd(Number(input))) {
              return 'Channel capacity must be even';
            }

            return true;
          },
        },
        ({capacity}) => cbk(null, Number(capacity)));
      }],

      // Ask for a chain fee rate
      askForFeeRate: [
        'askForCapacity',
        'askForCount',
        'getFeeRate',
        ({askForCount, getFeeRate}, cbk) =>
      {
        return ask({
          default: floor(getFeeRate.tokens_per_vbyte),
          name: 'rate',
          message: 'Chain fee per vbyte?',
          validate: input => {
            if (!input || !isNumber(input) || !Number(input)) {
              return false;
            }

            // Do not allow fractional fee rates
            if (round(Number(input)) !== Number(input)) {
              return 'Fractional fee rate setting is not supported';
            }

            return true;
          },
        },
        ({rate}) => cbk(null, rate));
      }],

      // Final group details
      group: [
        'askForCapacity',
        'askForCount',
        'askForFeeRate',
        ({askForCapacity, askForCount, askForFeeRate}, cbk) =>
      {
        return cbk(null, {
          capacity: askForCapacity,
          count: Number(askForCount),
          rate: askForFeeRate,
        });
      }],
    },
    returnResult({reject, resolve, of: 'group'}, cbk));
  });
};
