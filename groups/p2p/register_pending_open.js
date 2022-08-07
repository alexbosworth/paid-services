const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const asyncRetry = require('async/retry');
const {cancelPendingChannel} = require('ln-service');
const {connectPeer} = require('ln-sync');
const {decodePsbt} = require('psbt');
const {returnResult} = require('asyncjs-util');
const tinysecp = require('tiny-secp256k1');
const {Transaction} = require('bitcoinjs-lib');

const {decodeUnsignedFunding} = require('./../messages');
const {encodePendingProposal} = require('./../messages');
const {makePeerRequest} = require('./../../p2p');
const {serviceTypeRegisterPendingOpen} = require('./../../service_types');
const {signAndFundGroupChannel} = require('./../funding');

const bufferAsHex = buffer => buffer.toString('hex');
const defaultIntervalMs = 500;
const defaultPollTimes = 2 * 60 * 10;
const defaultRequestTimeoutMs = 1000 * 60;
const {fromHex} = Transaction;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;
const missingGroupPartners = 'NoGroupPartnersFound';
const typeGroupChannelId = '1';

/** Register pending open with the coordinator

  {
    capacity: <Channel Capacity Tokens Number>
    [change]: <Change Output Script Hex String>
    coordinator: <Group Coordinator Identity Public Key Hex String>
    funding: <Funding Output Script Hex String>
    group: <Group Identifier Hex String>
    lnd: <Authenticated LND API Object>
    overflow: <Expected Minimum Change Amount Tokens Number>
    [pending]: <Pending Channel Id Hex String>
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
      // Import ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

      // Check arguments
      validate: cbk => {
        if (!args.capacity) {
          return cbk([400, 'ExpectedChannelCapacityToRegisterPendingOpen']);
        }

        if (!args.coordinator) {
          return cbk([400, 'ExpectedCoordinatorToRegisterPendingOpen']);
        }

        if (!args.funding) {
          return cbk([400, 'ExpectedFundingOutputToRegisterPendingOpen']);
        }

        if (!args.group) {
          return cbk([400, 'ExpectedGroupIdToRegisterPendingOpen']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRegisterPendingOpen']);
        }

        if (!isArray(args.utxos)) {
          return cbk([400, 'ExpectedArrayOfUtxosToRegisterPendingOpen']);
        }

        return cbk();
      },

      // Connect to the coordinator to send the registered pending message
      connect: ['validate', ({}, cbk) => {
        return connectPeer({id: args.coordinator, lnd: args.lnd}, cbk);
      }],

      // Send connection confirmation request
      request: ['connect', asyncReflect(({}, cbk) => {
        const {records} = encodePendingProposal({
          change: args.change,
          funding: args.funding,
          id: args.group,
          utxos: args.utxos,
        });

        return asyncRetry({
          errorFilter: err => {
            const [code, message] = err;
        
            // Continue retrying when there are others still proposing
            if (message === missingGroupPartners) {
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
            type: serviceTypeRegisterPendingOpen,
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

      // Clean up the pending channel if registration fails
      clean: ['request', ({request}, cbk) => {
        // Exit early when there was no error registering the pending channel
        if (!request.error) {
          return cbk();
        }

        // Exit early if there is no pending id
        if (!args.pending) {
          return cbk();
        }

        return cancelPendingChannel({id: args.pending, lnd: args.lnd}, err => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorCleaningPendingChannel', {err}]);
          }

          // Return the original registration error
          return cbk(request.error);
        });
      }],

      // Check the unsigned funding transaction represents the partial open
      check: ['clean', 'ecp', 'request', ({ecp, request}, cbk) => {
        try {
          decodePsbt({ecp, psbt: request.value});
        } catch (err) {
          return cbk([503, 'ExpectedValidUnsignedResponsePsbt', {err}]);
        }

        const psbt = decodePsbt({ecp, psbt: request.value});

        const tx = fromHex(psbt.unsigned_transaction);

        // The utxos should be represented in the PSBT
        const missing = args.utxos.find(utxo => {
          const hash = hexAsBuffer(utxo.transaction_id).reverse();
          const vout = utxo.transaction_vout;

          return !tx.ins.find(n => n.hash.equals(hash) && n.index === vout);
        });

        if (!!missing) {
          return cbk([503, 'ExpectedAllInputsRepresentedInGroupChannelPsbt']);
        }

        const outputs = tx.outs.map(({script, value}) => ({
          script: bufferAsHex(script),
          tokens: value,
        }));

        const change = outputs.find(n => n.script === args.change);
        const funding = outputs.find(n => n.script === args.funding);

        // When there is overflow to receive, require a change output
        if (!!args.overflow && !change) {
          return cbk([503, 'ExpectedChangeOutputInUnsignedGroupChannelPsbt']);
        }

        // When change is expected it must have at least the excess value
        if (!!args.change && change.tokens < args.overflow) {
          return cbk([503, 'UnexpectedChangeAmountInUnsignedChannelPsbt']);
        }

        // The funding output should be represented in the outputs
        if (!funding) {
          return cbk([503, 'FailedToFindFundingOutputInUnsignedGroupPsbt']);
        }

        // Funding should match the channel capacity
        if (funding.tokens !== args.capacity) {
          return cbk([503, 'IncorrectFundingOutputValueInUnsignedGroupPsbt']);
        }

        return cbk();
      }],

      // Sign and fund the PSBT
      sign: ['check', 'request', ({request}, cbk) => {
        return signAndFundGroupChannel({
          id: args.pending,
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
