const {createHash} = require('crypto');

const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncReflect = require('async/reflect');
const {broadcastChainTransaction} = require('ln-service');
const {cancelHodlInvoice} = require('ln-service');
const {confirmationFee} = require('goldengate');
const {controlBlock} = require('p2tr');
const {createChainAddress} = require('ln-service');
const {createInvoice} = require('ln-service');
const {createPsbt} = require('psbt');
const {diffieHellmanComputeSecret} = require('ln-service');
const {fundPsbt} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getHeight} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getInvoice} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getPublicKey} = require('ln-service');
const {hashForTree} = require('p2tr');
const {pointAdd} = require('tiny-secp256k1');
const {returnResult} = require('asyncjs-util');
const {sendToChainOutputScripts} = require('ln-service');
const {settleHodlInvoice} = require('ln-service');
const {signPsbt} = require('ln-service');
const {signTransaction} = require('ln-service');
const {subscribeToBlocks} = require('ln-service');
const {subscribeToInvoice} = require('ln-service');
const {subscribeToSpend} = require('goldengate');
const {swapScriptBranches} = require('goldengate');
const {taprootRefundTransaction} = require('goldengate');
const tinysecp = require('tiny-secp256k1');
const {Transaction} = require('bitcoinjs-lib');
const {v1OutputScript} = require('p2tr');

const decodeOnToOffRecovery = require('./decode_on_to_off_recovery');
const {typePayMetadata} = require('./swap_field_types');

const bufferAsHex = buffer => buffer.toString('hex');
const defaultMaxFundingConfirmationDelay = 12;
const defaultMinDelta = 60;
const family = 805;
const flatten = arr => [].concat(...arr);
const {floor} = Math;
const {from} = Buffer;
const {fromHex} = Transaction;
const fuzzBlocks = 100;
const hexAsBase64 = hex => Buffer.from(hex, 'hex').toString('base64');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const historicBlocksRange = 144 * 30;
const maxRefundMultiple = (r, t) => Math.min(100, ((1000 + t) / 150) / r);
const {min} = Math;
const minBlocks = 50;
const pollInterval = {btcregtest: 100};
const pubKeyAsInternalKey = key => Buffer.from(key).slice(1).toString('hex');
const pubKeyAsSecret = hexPublicKey => hexPublicKey.slice(2);
const sha256 = preimage => createHash('sha256').update(preimage).digest('hex');
const sighash = Transaction.SIGHASH_DEFAULT;
const slowTarget = 144 * 7;
const sweepInputIndex = 0;
const times = n => Array(n).fill(null).map((_, i) => i);
const uniqBy = (a,b) => a.filter((e,i) => a.findIndex(n => n[b] == e[b]) == i);
const witnessLengthCoopSweep = 1;
const witnessLengthTimeoutSweep = 3;

/** Complete the on-chain side of the swap by taking the off-chain funds

  {
    emitter: <Event Emitter Object>
    [is_ignoring_deposit]: <Ignore Held Deposit Funds Bool>
    [fund_fee_rate]: <Fund Chain Fee Rate Number>
    lnd: <Authenticated LND API Object>
    recovery: <Swap Recovery Hex String>
    [request]: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import the ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

      // Check arguments
      validate: cbk => {
        if (!args.emitter) {
          return cbk([400, 'ExpectedEventEmitterToCompleteOnchainSwap']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToCompleteOnchainSwap']);
        }

        if (!args.recovery) {
          return cbk([400, 'ExpectedRecoveryStateToCompleteOnchainSwap']);
        }

        return cbk();
      },

      // Get the chain fee rate
      getChainFee: ['validate', ({}, cbk) => {
        return getChainFeeRate({
          confirmation_target: slowTarget,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get the current block height to find the chain spend
      getHeight: ['validate', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Get the identity key to decrypt the recovery details
      getIdentity: ['validate', ({}, cbk) => {
        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Get the network name for generating the timeout sweeps
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get an address to sweep out to
      getSweepAddress: ['validate', ({}, cbk) => {
        return createChainAddress({lnd: args.lnd}, cbk);
      }],

      // Get the encryption key to decode the recovery secrets
      getDecrypt: ['getIdentity', ({getIdentity}, cbk) => {
        return diffieHellmanComputeSecret({
          lnd: args.lnd,
          partner_public_key: getIdentity.public_key,
        },
        cbk);
      }],

      // Get chain transactions
      getTransactions: ['recoveryDetails', ({recoveryDetails}, cbk) => {
        return getChainTransactions({
          after: recoveryDetails.timeout - historicBlocksRange,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Recovery details
      recoveryDetails: ['getDecrypt', ({getDecrypt}, cbk) => {
        const decrypt = getDecrypt.secret;

        try {
          const details = decodeOnToOffRecovery({
            decrypt,
            recovery: args.recovery,
          });

          return cbk(null, {
            claim_coop_public_key_hash: details.claim_coop_public_key_hash,
            claim_solo_public_key: details.claim_solo_public_key,
            hash: details.hash,
            key_index: details.key_index,
            refund_coop_private_key: details.refund_coop_private_key,
            refund_coop_private_key_hash: details.refund_coop_private_key_hash,
            solo_private_key: details.refund_solo_private_key,
            timeout: details.timeout,
            tokens: details.tokens,
          });
        } catch (err) {
          return cbk([400, 'ExpectedValidOnToOffRecoveryDetails', {err}]);
        }
      }],

      // Get the refund key
      getRefundKey: [
        'ecp',
        'recoveryDetails',
        ({ecp, recoveryDetails}, cbk) =>
      {
        // Exit early when a unilateral private key is defined
        if (!!recoveryDetails.solo_private_key) {
          const privateKey = hexAsBuffer(recoveryDetails.solo_private_key);

          const {publicKey} = ecp.fromPrivateKey(privateKey);

          return cbk(null, {public_key: bufferAsHex(publicKey)});
        }

        return getPublicKey({
          family,
          index: recoveryDetails.key_index,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Wait for the deposit hold which also contains the cooperative pubkey
      waitForDepositHold: ['recoveryDetails', ({recoveryDetails}, cbk) => {
        const id = recoveryDetails.refund_coop_private_key_hash;

        const sub = subscribeToInvoice({id, lnd: args.lnd});

        args.emitter.emit('update', {waiting_for_execution_payment_to: id});

        sub.on('error', err => {
          sub.removeAllListeners();

          return cbk(err);
        });

        sub.on('invoice_updated', invoice => {
          // Exit early when the payment has not arrived yet
          if (!invoice.is_held) {
            return;
          }

          const hash = recoveryDetails.claim_coop_public_key_hash;
          const timeout = min(...invoice.payments.map(n => n.timeout));

          const message = flatten(invoice.payments.map(n => n.messages))
            .filter(({type}) => type === typePayMetadata)
            .find(({value}) => sha256(hexAsBuffer(value)) === hash);

          // Exit early when there is no cooperative key
          if (!message) {
            return;
          }

          const delta = timeout - recoveryDetails.timeout;

          sub.removeAllListeners();

          args.emitter.emit('update', {execution_payment_held: id});

          return cbk(null, {delta, claim_coop_public_key: message.value});
        });
      }],

      // Wait for off chain funding
      waitForFundHold: ['recoveryDetails', ({recoveryDetails}, cbk) => {
        const id = recoveryDetails.hash;

        args.emitter.emit('update', {waiting_for_offchain_funds: id});

        const sub = subscribeToInvoice({id, lnd: args.lnd});

        sub.on('error', err => {
          sub.removeAllListeners();

          return cbk(err);
        });

        sub.on('invoice_updated', invoice => {
          // Exit early when the payment has not arrived yet
          if (!invoice.is_held) {
            return;
          }

          args.emitter.emit('update', {offchain_funding_held: id});

          const timeout = min(...invoice.payments.map(n => n.timeout));

          const delta = timeout - recoveryDetails.timeout;

          sub.removeAllListeners();

          return cbk(null, {delta});
        });

        return;
      }],

      // Derive swap details
      swap: [
        'ecp',
        'getRefundKey',
        'recoveryDetails',
        'waitForDepositHold',
        ({ecp, getRefundKey, recoveryDetails, waitForDepositHold}, cbk) =>
      {
        const privateKey = recoveryDetails.refund_coop_private_key;

        const jointPublicKey = pointAdd(
          ecp.fromPrivateKey(hexAsBuffer(privateKey)).publicKey,
          hexAsBuffer(waitForDepositHold.claim_coop_public_key)
        );

        const swapScript = swapScriptBranches({
          ecp,
          claim_public_key: recoveryDetails.claim_solo_public_key,
          hash: recoveryDetails.hash,
          refund_public_key: getRefundKey.public_key,
          timeout: recoveryDetails.timeout,
        });

        const output = v1OutputScript({
          hash: hashForTree({branches: swapScript.branches}).hash,
          internal_key: bufferAsHex(from(jointPublicKey)),
        });

        return cbk(null, {
          external_key: output.external_key,
          hash: recoveryDetails.hash,
          internal_key: pubKeyAsInternalKey(jointPublicKey),
          output_script: output.script,
          refund_script: swapScript.refund,
          script_branches: swapScript.branches,
          tokens: recoveryDetails.tokens,
        });
      }],

      // Generate the refund transactions against the inbound HTLC deadline
      refunds: [
        'ecp',
        'getChainFee',
        'getNetwork',
        'getRefundKey',
        'getSweepAddress',
        'outpoint',
        'recoveryDetails',
        'swap',
        'waitForFundHold',
        ({
          ecp,
          getChainFee,
          getNetwork,
          getRefundKey,
          getSweepAddress,
          outpoint,
          recoveryDetails,
          swap,
          waitForFundHold,
        },
        cbk) =>
      {
        const before = waitForFundHold.delta;
        const fee = getChainFee.tokens_per_vbyte;

        const multiplier = maxRefundMultiple(fee, recoveryDetails.tokens);

        const feeRates = times(before).map(cursor => {
          const {rate} = confirmationFee({before, cursor, fee, multiplier});

          return {
            rate: floor(rate),
            height: recoveryDetails.timeout + cursor,
          };
        });

        const refunds = uniqBy(feeRates, 'rate').map(({rate, height}) => {
          return taprootRefundTransaction({
            ecp,
            block_height: height,
            external_key: swap.external_key,
            fee_tokens_per_vbyte: rate,
            internal_key: swap.internal_key,
            network: getNetwork.network,
            output_script: swap.output_script,
            private_key: recoveryDetails.solo_private_key,
            refund_script: swap.refund_script,
            script_branches: swap.script_branches,
            sweep_address: getSweepAddress.address,
            tokens: recoveryDetails.tokens,
            transaction_id: outpoint.id,
            transaction_vout: outpoint.vout,
          });
        });

        return cbk(null, refunds.map(n => n.transaction));
      }],

      // Sign the refund transactions
      signRefunds: [
        'recoveryDetails',
        'refunds',
        'swap',
        ({recoveryDetails, refunds, swap}, cbk) =>
      {
        // Exit early when refunds are already signed
        if (!!recoveryDetails.solo_private_key) {
          return cbk(null, refunds);
        }

        return asyncMap(refunds, (transaction, cbk) => {
          return signTransaction({
            transaction,
            inputs: [{
              sighash,
              key_family: family,
              key_index: recoveryDetails.key_index,
              output_script: swap.output_script,
              output_tokens: recoveryDetails.tokens,
              vin: sweepInputIndex,
              witness_script: swap.refund_script,
            }],
            lnd: args.lnd,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            const [signature] = res.signatures;

            const {block} = controlBlock({
              internal_key: swap.internal_key,
              external_key: swap.external_key,
              leaf_script: swap.refund_script,
              script_branches: swap.script_branches,
            });

            const witness = [signature, swap.refund_script, block];

            const tx = fromHex(transaction);

            // Add the signature to the sweep
            tx.ins.forEach((input, vin) => {
              return tx.setWitness(vin, witness.map(hexAsBuffer));
            });

            return cbk(null, tx.toHex());
          });
        },
        cbk);
      }],

      // Check that there are sufficient remaining blocks
      checkTimeRemaining: [
        'recoveryDetails',
        'waitForDepositHold',
        'waitForFundHold',
        ({recoveryDetails, waitForDepositHold, waitForFundHold}, cbk) =>
      {
        if (waitForDepositHold.delta < defaultMinDelta) {
          return cbk([503, 'InsufficientDepositDeltaBlocksToFundSwap']);
        }

        if (waitForFundHold.delta < defaultMinDelta) {
          return cbk([503, 'InsufficientFundingDeltaBlocksToFundSwap']);
        }

        return getHeight({lnd: args.lnd}, (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const delta = recoveryDetails.timeout - res.current_block_height;

          args.emitter.emit('update', {blocks_remaining_until_timeout: delta});

          // The blocks until timeout have to be sufficient for confirm & sweep
          if (delta < minBlocks) {
            return cbk([400, 'InsufficientBlocksRemainingForSwap']);
          }

          return cbk();
        });
      }],

      // Lock chain funds to fund the swap with
      lockFunding: [
        'checkTimeRemaining',
        'getTransactions',
        'swap',
        ({getTransactions, swap}, cbk) =>
      {
        const tx = getTransactions.transactions.find(({transaction}) => {
          return !!transaction && !!fromHex(transaction).outs.find(output => {
            if (output.value !== swap.tokens) {
              return false;
            }

            return bufferAsHex(output.script) === swap.output_script;
          });
        });

        // Exit early when there is already a funding tx
        if (!!tx) {
          return cbk(null, {transaction: tx.transaction});
        }

        // Create a PSBT to specify the output P2TR
        const {psbt} = createPsbt({
          outputs: [{script: swap.output_script, tokens: swap.tokens}],
          utxos: [],
        });

        return fundPsbt({
          psbt,
          fee_tokens_per_vbyte: args.fund_fee_rate,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Sign the on-chain funding to get a signed raw tx
      signFunding: ['lockFunding', ({lockFunding}, cbk) => {
        if (!!lockFunding.transaction) {
          return cbk(null, {
            is_already_broadcast: true,
            transaction: lockFunding.transaction,
          });
        }

        return signPsbt({lnd: args.lnd, psbt: lockFunding.psbt}, cbk);
      }],

      // Output funding the swap on chain
      outpoint: ['signFunding', 'swap', ({signFunding, swap}, cbk) => {
        const tx = fromHex(signFunding.transaction);
        const script = hexAsBuffer(swap.output_script);

        const id = tx.getId();
        const vout = tx.outs.findIndex(n => n.script.equals(script));

        args.emitter.emit('update', {
          funding_transaction_id: id,
          funding_transaction_vout: vout,
        });

        return cbk(null, {id, vout});
      }],

      // Broadcast the funding transaction
      broadcastFunding: [
        'signFunding',
        'signRefunds',
        ({signFunding, signRefunds}, cbk) =>
      {
        const [refund] = signRefunds;

        args.emitter.emit('update', {
          refund_transaction: refund,
          refund_valid_at: fromHex(refund).locktime,
        });

        // Exit early when the transaction was already published
        if (!!signFunding.is_already_broadcast) {
          return cbk();
        }

        return broadcastChainTransaction({
          description: `swap funding. refund: ${hexAsBase64(refund)}`,
          lnd: args.lnd,
          transaction: signFunding.transaction,
        },
        cbk);
      }],

      // Wait for the preimage push or the claim spend
      findSecret: [
        'getHeight',
        'getNetwork',
        'outpoint',
        'recoveryDetails',
        'signRefunds',
        'swap',
        ({
          getHeight,
          getNetwork,
          outpoint,
          recoveryDetails,
          signRefunds,
          swap,
        },
        cbk) =>
      {
        const id = recoveryDetails.claim_coop_public_key_hash;

        const subPush = subscribeToInvoice({id, lnd: args.lnd});

        const subSpend = subscribeToSpend({
          delay_ms: pollInterval[getNetwork.network],
          lnd: args.lnd,
          min_height: getHeight.current_block_height - fuzzBlocks,
          network: getNetwork.network,
          output_script: swap.output_script,
          request: args.request,
          transaction_id: outpoint.id,
          transaction_vout: outpoint.vout,
        });

        const subTimeout = subscribeToBlocks({lnd: args.lnd});

        const done = (err, res) => {
          subPush.removeAllListeners();
          subSpend.removeAllListeners();
          subTimeout.removeAllListeners();

          return cbk(err, res);
        };

        subPush.on('error', err => done(err));

        subPush.on('invoice_updated', invoice => {
          // Exit early when the invoice isn't held
          if (!invoice.is_held) {
            return;
          }

          const {messages} = invoice.payments.find(payment => {
            return !!payment.messages.find(n => n.type === typePayMetadata);
          });

          const message = messages.find(n => n.type === typePayMetadata);

          if (!message) {
            return;
          }

          if (sha256(hexAsBuffer(message.value)) !== recoveryDetails.hash) {
            return;
          }

          const secret = message.value;

          args.emitter.emit('update', {received_cooperative_secret: secret});

          return done(null, {secret});
        });

        // Look for the preimage to be used on-chain in a sweep
        subSpend.on('confirmation', ({transaction}) => {
          const spend = fromHex(transaction).ins.find(input => {
            if (!input.hash.equals(hexAsBuffer(outpoint.id).reverse())) {
              return false;
            }

            return input.index === outpoint.vout;
          });

          // Exit early when swap is spent with a signature
          if (spend.witness.length === witnessLengthCoopSweep) {
            args.emitter.emit('update', {swap_coop_success: transaction});

            return;
          }

          // Exit early when swap is spent with a timeout
          if (spend.witness.length === witnessLengthTimeoutSweep) {
            args.emitter.emit('update', {swap_timeout_complete: transaction});

            // Don't bother waiting for swap funding anymore
            return cancelHodlInvoice({
              id: recoveryDetails.hash,
              lnd: args.lnd,
            },
            () => {
              return done([503, 'SwapFailedViaTimeout']);
            });
          }

          args.emitter.emit('update', {swap_peer_solo_success: transaction});

          const [secret] = spend.witness;

          return done(null, {secret: bufferAsHex(secret)});
        });

        subSpend.on('error', err => done(err));

        subTimeout.on('block', block => {
          const delta = recoveryDetails.timeout - block.height;

          args.emitter.emit('update', {blocks_until_timeout: delta});

          if (block.height < recoveryDetails.timeout) {
            return;
          }

          // Find the latest valid refund transaction
          const [transaction] = signRefunds
            .filter(transaction => {
              return fromHex(transaction).locktime <= block.height;
            })
            .reverse();

          args.emitter.emit('update', {broadcasting_refund: transaction});

          return broadcastChainTransaction({
            transaction,
            lnd: args.lnd,
          },
          () => {});
        });

        subTimeout.on('error', err => done(err));

        return;
      }],

      // Cancel the preimage push back to the sender
      cancelPushHold: [
        'findSecret',
        'recoveryDetails',
        asyncReflect(({findSecret, recoveryDetails}, cbk) =>
      {
        return cancelHodlInvoice({
          id: recoveryDetails.claim_coop_public_key_hash,
          lnd: args.lnd,
        },
        cbk);
      })],

      // Get the status of the funding
      getSettlement: ['findSecret', 'swap', ({swap}, cbk) => {
        return getInvoice({id: swap.hash, lnd: args.lnd}, cbk);
      }],

      // Settle the incoming funds HTLC
      takeFunding: [
        'findSecret',
        'getSettlement',
        ({findSecret, getSettlement}, cbk) =>
      {
        // Exit early when invoice is already settled
        if (!!getSettlement.is_confirmed) {
          return cbk();
        }

        args.emitter.emit('update', {receiving_funds: getSettlement.tokens});

        return settleHodlInvoice({
          lnd: args.lnd,
          secret: findSecret.secret,
        },
        cbk);
      }],

      // Settle the incoming deposit HTLC after funding is taken
      takeDeposit: [
        'recoveryDetails',
        'takeFunding',
        'waitForDepositHold',
        ({recoveryDetails}, cbk) =>
      {
        // Exit early when ignoring the deposit
        if (!!args.is_ignoring_deposit) {
          return cbk();
        }

        const privateKey = recoveryDetails.refund_coop_private_key;

        args.emitter.emit('update', {sending_cooperative_privkey: privateKey});

        return settleHodlInvoice({lnd: args.lnd, secret: privateKey}, cbk);
      }],

      // Get the settled deposit
      getDeposit: [
        'recoveryDetails',
        'takeDeposit',
        asyncReflect(({recoveryDetails}, cbk) =>
      {
        const id = recoveryDetails.refund_coop_private_key_hash;

        return getInvoice({id, lnd: args.lnd}, cbk);
      })],

      // Look up the funding to see how much was settled
      getFunding: ['swap', 'takeFunding', asyncReflect(({swap}, cbk) => {
        return getInvoice({id: swap.hash, lnd: args.lnd}, cbk);
      })],

      // Summary of swap results
      summary: [
        'getDeposit',
        'getFunding',
        'outpoint',
        'recoveryDetails',
        ({getDeposit, getFunding, outpoint, recoveryDetails}, cbk) =>
      {
        const deposit = getDeposit.value || {};
        const funding = getFunding.value || {};

        return cbk(null, {
          funded_transaction_id: outpoint.id,
          funded_transaction_vout: outpoint.vout,
          received_for_swap_execution: deposit.received,
          received_for_swap_funding: funding.received,
          send_to_fund_swap_onchain: recoveryDetails.tokens,
        });
      }],
    },
    returnResult({reject, resolve, of: 'summary'}, cbk));
  });
};
