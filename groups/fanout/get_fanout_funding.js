const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncTimesSeries = require('async/timesSeries');
const {createChainAddress} = require('ln-service');
const {fundPsbt} = require('ln-service');
const {decodePsbt} = require('psbt');
const {getUtxos} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const tinysecp = require('tiny-secp256k1');
const {unlockUtxo} = require('ln-service');

const allowedAddressFormats = ['p2tr', 'p2wpkh'];
const asOutpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const format = 'p2tr';
const {isArray} = Array;
const isNumber = n => !isNaN(n);
const sumOf = arr => arr.reduce((sum, n) => sum + n, 0);

/** Get fanout funding details

  {
    capacity: <Fanout Output Capacity Tokens Number>
    inputs: [<Transaction Id:Transaction Vout Outpoint String>]
    lnd: <Authenticated LND API Object>
    outputs: <Output Count Number>
    rate: <Fee Rate Tokens Per VBytes Number>
  }

  @returns via cbk or Promise
  {
    [change]: <Change Output Script Hex String>
    funding: [<Funding Output Script Hex String>]
    [overflow]: <Funding Overflow Number>
    utxos: [{
      bip32_derivations: [{
        fingerprint: <Public Key Fingerprint Hex String>
        [leaf_hashes]: <Taproot Leaf Hash Hex String>
        path: <BIP 32 Child / Hardened Child / Index Derivation Path String>
        public_key: <Public Key Hex String>
      }]
      lock_id: <UTXO Lock Id Hex String>
      [non_witness_utxo]: <UTXO Spending Transaction Hex String>
      transaction_id: <Unspent Transaction Id Hex String>
      transaction_vout: <Unspent Transaction Output Index Number>
      witness_utxo: {
        script_pub: <UTXO Output Script Hex String>
        tokens: <UTXO Tokens Value Number>
      }
    }]
  }
*/
module.exports = ({capacity, inputs, lnd, outputs, rate}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

      // Check arguments
      validate: cbk => {
        if (!capacity) {
          return cbk([400, 'ExpectedCapacityToGetFanoutFundingDetails']);
        }

        if (!isArray(inputs) || !inputs.length) {
          return cbk([400, 'ExpectedArrayOfInputsToGetFanoutFundingDetails']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetFanoutFunding']);
        }

        if (!outputs || !isNumber(outputs)) {
          return cbk([400, 'ExpectedOutputCountToGetFanoutFundingDetails']);
        }

        if (!rate) {
          return cbk([400, 'ExpectedChainFeeRateToGetFanoutFundingDetails']);
        }

        return cbk();
      },

      // Get the full set of UTXOs to quickly check if there are enough funds
      getInputs: ['validate', ({}, cbk) => getUtxos({lnd}, cbk)],

      // Filter UTXOs for the inputs that are going to be used
      spend: ['getInputs', ({getInputs}, cbk) => {
        // Exit early when a provided input does not match a known UTXO
        if (!inputs.every(n => getInputs.utxos.map(asOutpoint).includes(n))) {
          return cbk([400, 'ExpectedKnownUtxosToProposeFanout']);
        }

        // Collect the set of inputs that are going to be spent
        const spending = getInputs.utxos.filter(utxo => {
          return inputs.includes(asOutpoint(utxo));
        });

        // Look to see if there is an invalid input
        const unsupportedUtxo = spending.find(utxo => {
          return !allowedAddressFormats.includes(utxo.address_format);
        });

        // Exit with error when there is an invalid UTXO selected
        if (!!unsupportedUtxo) {
          return cbk([400, 'UnexpectedInputAddressFormatToGetFundingDetails']);
        }

        // Exit with error when the UTXOs don't cover the needed output value
        if (sumOf(spending.map(({tokens}) => tokens)) < capacity * outputs) {
          return cbk([400, 'ExpectedUtxosWithSufficientFundsToProposeFanout']);
        }

        return cbk(null, spending.map(utxo => ({
          transaction_id: utxo.transaction_id,
          transaction_vout: utxo.transaction_vout,
        })));
      }],

      // After confirming the inputs are ok, make addresses to use for funding
      getAddresses: ['spend', ({}, cbk) => {
        return asyncTimesSeries(outputs, (_, cbk) => {
          return createChainAddress({format, lnd}, cbk);
        },
        cbk);
      }],

      // Fund the addresses to populate UTXOs that can be used
      fund: ['getAddresses', 'spend', ({getAddresses, spend}, cbk) => {
        return fundPsbt({
          lnd,
          inputs: spend.map(input => ({
            transaction_id: input.transaction_id,
            transaction_vout: input.transaction_vout,
          })),
          fee_tokens_per_vbyte: rate,
          outputs: getAddresses.map(created => ({
            address: created.address,
            tokens: capacity,
          })),
        },
        cbk);
      }],

      // Unlock UTXOs to undo the PSBT funding locks
      unlock: ['fund', ({fund}, cbk) => {
        return asyncEach(fund.inputs, (input, cbk) => {
          return unlockUtxo({
            lnd,
            id: input.lock_id,
            transaction_id: input.transaction_id,
            transaction_vout: input.transaction_vout,
          },
          cbk);
        },
        cbk);
      }],

      // Put together final funding elements to use for PSBT construction
      funding: ['ecp', 'fund', ({ecp, fund}, cbk) => {
        const change = fund.outputs.find(n => n.is_change) || {};
        const funding = fund.outputs.filter(n => !n.is_change);
        const {inputs} = decodePsbt({ecp, psbt: fund.psbt});

        // UTXOs have been selected
        return cbk(null, {
          change: change.output_script || undefined,
          funding: funding.map(n => n.output_script),
          overflow: change.tokens || undefined,
          utxos: fund.inputs.map((input, vin) => ({
            bip32_derivations: inputs[vin].bip32_derivations,
            lock_id: input.lock_id,
            non_witness_utxo: inputs[vin].non_witness_utxo,
            transaction_id: input.transaction_id,
            transaction_vout: input.transaction_vout,
            witness_utxo: inputs[vin].witness_utxo,
          })),
        });
      }],
    },
    returnResult({reject, resolve, of: 'funding'}, cbk));
  });
};
