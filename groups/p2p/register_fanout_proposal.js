const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const asyncRetry = require('async/retry');
const {cancelPendingChannel} = require('ln-service');
const {connectPeer} = require('ln-sync');
const {decodePsbt} = require('psbt');
const {returnResult} = require('asyncjs-util');
const {signAndFundPsbt} = require('ln-sync');
const tinysecp = require('tiny-secp256k1');
const {Transaction} = require('bitcoinjs-lib');

const {decodeUnsignedFunding} = require('./../messages');
const {encodeFanoutProposal} = require('./../messages');
const estimateFeeRate = require('./../estimate_fee_rate');
const {makePeerRequest} = require('./../../p2p');
const {serviceTypeRegisterPendingFanout} = require('./../../service_types')

const bufferAsHex = buffer => buffer.toString('hex');
const defaultIntervalMs = 500;
const defaultPollTimes = 2 * 60 * 30;
const defaultRequestTimeoutMs = 1000 * 60;
const {fromHex} = Transaction;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;
const missingGroupPartners = 'NoGroupPartnersFound';
const typeGroupChannelId = '1';

/** Register fanout proposal with the coordinator

  {
    capacity: <Channel Capacity Tokens Number>
    [change]: <Change Output Script Hex String>
    coordinator: <Group Coordinator Identity Public Key Hex String>
    funding: [<Funding Output Script Hex String>]
    group: <Group Identifier Hex String>
    lnd: <Authenticated LND API Object>
    [overflow]: <Expected Minimum Change Amount Tokens Number>
    rate: <Chain Fee Rate Tokens Per VByte Number>
    utxos: [{
      [non_witness_utxo]: <Non Witness Transaction Hex String>
      transaction_id: <Transaction Id Hex String>
      transaction_vout: <Transaction Output Index Number>
      witness_utxo: {
        script_pub: <UTXO Output Script Hex String>
        tokens: <UTXO Tokens Value Number>
      }
    }]
  }

  @returns via cbk or Promise
  {
    conflict: <Conflict Transaction Hex String>
    psbt: <Partially Signed PSBT Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import ECPair library to use for funding checks
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

      // Check arguments
      validate: cbk => {
        if (!args.capacity) {
          return cbk([400, 'ExpectedChannelCapacityToRegisterFanoutProposal']);
        }

        if (!args.coordinator) {
          return cbk([400, 'ExpectedCoordinatorToRegisterFanoutProposal']);
        }

        if (!args.funding) {
          return cbk([400, 'ExpectedFundingOutputToRegisterFanoutProposal']);
        }

        if (!args.group) {
          return cbk([400, 'ExpectedGroupIdToRegisterFanoutProposal']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToSendFanoutProposal']);
        }

        if (!args.rate) {
          return cbk([400, 'ExpectedChainFeeRateToRegisterFanoutProposal']);
        }

        if (!isArray(args.utxos)) {
          return cbk([400, 'ExpectedArrayOfUtxosToRegisterFanoutProposal']);
        }

        return cbk();
      },

      // Connect to the coordinator to send the fanout proposal message
      connect: ['validate', ({}, cbk) => {
        return connectPeer({id: args.coordinator, lnd: args.lnd}, cbk);
      }],

      // Send fanout proposal request
      request: ['connect', asyncReflect(({}, cbk) => {
        const {records} = encodeFanoutProposal({
          change: args.change,
          funding: args.funding,
          id: args.group,
          utxos: args.utxos,
        });

        return asyncRetry({
          errorFilter: err => {
            const [code, message] = err;

            // Continue retrying on error, or when others are still proposing
            if (!code || message === missingGroupPartners) {
              return true;
            }

            return false;
          },
          interval: defaultIntervalMs,
          times: defaultPollTimes,
        },
        cbk => {
          return makePeerRequest({
            records,
            lnd: args.lnd,
            timeout: defaultRequestTimeoutMs,
            to: args.coordinator,
            type: serviceTypeRegisterPendingFanout,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            if (!res.records || !res.records.length) {
              return cbk([503, missingGroupPartners]);
            }

            try {
              decodeUnsignedFunding({records: res.records});
            } catch (err) {
              return cbk([503, err.message]);
            }

            const {psbt} = decodeUnsignedFunding({records: res.records});

            return cbk(null, psbt);
          });
        },
        cbk);
      })],

      // Check the unsigned funding transaction represents the funding
      check: ['ecp', 'request', ({ecp, request}, cbk) => {
        try {
          decodePsbt({ecp, psbt: request.value});
        } catch (err) {
          return cbk([503, 'ExpectedValidUnsignedResponsePsbt', {err}]);
        }

        const psbt = decodePsbt({ecp, psbt: request.value});

        if (!!psbt.inputs.find(n => !n.witness_utxo)) {
          return cbk([503, 'ExpectedAllFanoutInputsSpendingWitnessUtxos']);
        }

        const tx = fromHex(psbt.unsigned_transaction);

        const estimated = estimateFeeRate({
          inputs: psbt.inputs,
          outputs: tx.outs.map(n => ({tokens: n.value})),
          unsigned: psbt.unsigned_transaction,
        });

        if (estimated.rate < args.rate) {
          return cbk([503, 'ExpectedGreaterChainFeeRateForFanoutPsbt']);
        }

        // All the specified utxos should be represented in the PSBT
        const missingInput = args.utxos.find(utxo => {
          const hash = hexAsBuffer(utxo.transaction_id).reverse();
          const vout = utxo.transaction_vout;

          return !tx.ins.find(n => n.hash.equals(hash) && n.index === vout);
        });

        if (!!missingInput) {
          return cbk([503, 'ExpectedAllInputsRepresentedInFanoutGroupPsbt']);
        }

        const outputs = tx.outs.map(({script, value}) => ({
          script: bufferAsHex(script),
          tokens: value,
        }));

        const change = outputs.find(n => n.script === args.change);
        const funding = outputs.filter(n => args.funding.includes(n.script));

        // When there is overflow to receive, require a change output
        if (!!args.overflow && !change) {
          return cbk([503, 'ExpectedChangeOutputInUnsignedFanoutGroupPsbt']);
        }

        // When change is expected it must have at least the excess value
        if (!!args.change && change.tokens < args.overflow) {
          return cbk([503, 'UnexpectedChangeAmountInUnsignedFanoutPsbt']);
        }

        // The funding outputs should all be represented in the outputs
        if (funding.length !== args.funding.length) {
          return cbk([503, 'FailedToFindFundingOutputInUnsignedFanoutPsbt']);
        }

        // All the funding outputs should have the correct output value
        if (!!funding.find(n => n.tokens !== args.capacity)) {
          return cbk([503, 'ExpectedFundingOutputsRepresentingFanoutSize']);
        }

        return cbk();
      }],

      // Once all are ready, sign and fund the PSBT for the fanout
      sign: ['check', 'request', ({request}, cbk) => {
        return signAndFundPsbt({
          lnd: args.lnd,
          psbt: request.value,
          utxos: args.utxos,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'sign'}, cbk));
  });
};
