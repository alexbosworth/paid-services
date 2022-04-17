const {createHash} = require('crypto');
const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncRace = require('async/race');
const asyncReflect = require('async/reflect');
const {bech32m} = require('bech32');
const {broadcastChainTransaction} = require('ln-service');
const {confirmationFee} = require('goldengate');
const {controlBlock} = require('p2tr');
const {createChainAddress} = require('ln-service');
const {diffieHellmanComputeSecret} = require('ln-service');
const {findConfirmedOutput} = require('ln-sync');
const {findDeposit} = require('goldengate');
const {getChainFeeRate} = require('ln-service');
const {getHeight} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getPayment} = require('ln-service');
const {getPublicKey} = require('ln-service');
const {hashForTree} = require('p2tr');
const {networks} = require('bitcoinjs-lib');
const {parsePaymentRequest} = require('ln-service');
const {pay} = require('ln-service');
const {payViaPaymentDetails} = require('ln-service');
const {pointAdd} = require('tiny-secp256k1');
const {privateAdd} = require('tiny-secp256k1');
const {returnResult} = require('asyncjs-util');
const {script} = require('bitcoinjs-lib');
const {signTransaction} = require('ln-service');
const {subscribeToBlocks} = require('ln-service');
const {subscribeToPastPayment} = require('ln-service');
const {subscribeToSpend} = require('goldengate');
const {swapScriptBranches} = require('goldengate');
const {taprootClaimTransaction} = require('goldengate');
const {taprootCoopTransaction} = require('goldengate');
const tinysecp = require('tiny-secp256k1');
const {Transaction} = require('bitcoinjs-lib');
const {v1OutputScript} = require('p2tr');

const decodeOffToOnRecovery = require('./decode_off_to_on_recovery');
const decodeOffToOnResponse = require('./decode_off_to_on_response');
const {typePayMetadata} = require('./swap_field_types');

const bufferAsHex = buffer => buffer.toString('hex');
const {ceil} = Math;
const decompileOutputScript = hex => script.decompile(Buffer.from(hex, 'hex'));
const defaultConfsCount = 1;
const defaultDepositSettleTimeoutMs = 1000 * 60 * 10;
const defaultMaxFeeMultiplier = 1000;
const defaultMaxPreimagePushFee = 10;
const defaultMinSweepBlocks = 20;
const defaultWaitForChainFundingMs = 1000 * 60 * 60 * 3;
const encodeAddress = (prefix, data) => bech32m.encode(prefix, data);
const family = 805;
const {floor} = Math;
const {from} = Buffer;
const {fromHex} = Transaction;
const fuzzBlocks = 100;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const maxClaimMultiple = (r, t) => Math.min(1000, ((1000 + t) / 150) / r);
const maxCoopMultiple = (r, t) => Math.min(1000, ((1000 + t) / 100) / r);
const messageRejected = 'PaymentRejectedByDestination';
const minTokens = 10000;
const minBlockMs = 1000 * 60;
const pollInterval = {btcregtest: 100};
const preimageByteLength = 32;
const pubKeyAsInternalKey = key => Buffer.from(key).slice(1).toString('hex');
const sha256 = preimage => createHash('sha256').update(preimage).digest('hex');
const sighash = Transaction.SIGHASH_DEFAULT;
const slowConfs = 144 * 7;
const sweepInputIndex = 0;
const times = n => Array(n).fill(null).map((_, i) => i);
const tokensForPushPreimage = 1;
const uniqBy = (a,b) => a.filter((e,i) => a.findIndex(n => n[b] == e[b]) == i);
const v1AddressWords = key => [].concat(1).concat(bech32m.toWords(key));

/** Complete the off to on swap

  {
    emitter: <Event Emitter Object>
    [is_avoiding_broadcast]: <Avoid Sweep Broadcast Bool>
    [is_uncooperative]: <Avoid Cooperative Signing Bool>
    lnd: <Autenticated LND API Object>
    max_fee_deposit: <Max Routing Fee Tokens For Deposit Number>
    max_fee_funding: <Max Routing Fee Tokens For Funding Number>
    [min_confirmations]: <Confirmation Blocks Number>
    recovery: <Swap Request Recovery Hex String>
    [request]: <Request Function>
    response: <Swap Response Hex String>
  }

  @returns via cbk or Promise
  {
    transactions: [<Sweep Transaction Hex String>]
  }
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
          return cbk([400, 'ExpectedAuthenticatedLndToCompleteOffToOnSwap']);
        }

        if (args.max_fee_deposit === undefined) {
          return cbk([400, 'ExpectedMaxRoutingFeeForDepositInOffToOnSwap']);
        }

        if (args.max_fee_funding === undefined) {
          return cbk([400, 'ExpectedMaxRoutingFeeForFundingOffToOnSwap']);
        }

        if (!args.recovery) {
          return cbk([400, 'ExpectedRecoveryDetailsToCompleteOffToOnSwap']);
        }

        if (!args.response) {
          return cbk([400, 'ExpectedRequestResponseToCompleteOffToOnSwap']);
        }

        return cbk();
      },

      // Create a sweep address
      createAddress: ['validate', ({}, cbk) => {
        return createChainAddress({lnd: args.lnd}, cbk);
      }],

      // Get the current chain fee rate for the sweep fee rate calculation
      getFeeRate: ['validate', ({}, cbk) => {
        return getChainFeeRate({
          confirmation_target: slowConfs,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get the current height of the chain for start height calculations
      getHeight: ['validate', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Get the self public key to use for the decryption key
      getIdentity: ['validate', ({}, cbk) => {
        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Get the network to use for parsing payment requests and addresses
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get the encryption key to decode the recovery secrets
      getDecrypt: ['getIdentity', ({getIdentity}, cbk) => {
        return diffieHellmanComputeSecret({
          lnd: args.lnd,
          partner_public_key: getIdentity.public_key,
        },
        cbk);
      }],

      // Decode the request details
      requestDetails: ['getDecrypt', ({getDecrypt}, cbk) => {
        try {
          const details = decodeOffToOnRecovery({
            decrypt: getDecrypt.secret,
            recovery: args.recovery,
          });

          if (details.tokens < minTokens) {
            return cbk([400, 'ExpectedHigherAmountToSwap']);
          }

          return cbk(null, {
            coop_private_key: details.coop_private_key,
            key_index: details.key_index,
            secret: details.secret,
            solo_private_key: details.solo_private_key,
            tokens: details.tokens,
          });
        } catch (err) {
          return cbk([400, 'FailedToDecodeRequestDetails', {err}]);
        }
      }],

      // Decode the response details
      responseDetails: ['getNetwork', ({getNetwork}, cbk) => {
        try {
          // Decode the response
          const decoded = decodeOffToOnResponse({
            network: getNetwork.bitcoinjs,
            response: args.response,
          });

          return cbk(null, {
            coop_private_key_hash: decoded.coop_private_key_hash,
            coop_public_key: decoded.coop_public_key,
            deposit_mtokens: decoded.deposit_mtokens,
            deposit_payment: decoded.deposit_payment,
            push: decoded.push,
            refund_public_key: decoded.refund_public_key,
            request: decoded.request,
            timeout: decoded.timeout,
          });
        } catch (err) {
          return cbk([400, 'FailedToDecodeResponseDetails', {err}]);
        }
      }],

      // Get the claim public key
      getClaimKey: ['ecp', 'requestDetails', ({ecp, requestDetails}, cbk) => {
        // Exit early when a private key is defined
        if (!!requestDetails.solo_private_key) {
          const privateKey = hexAsBuffer(requestDetails.solo_private_key);

          const {publicKey} = ecp.fromPrivateKey(privateKey);

          return cbk(null, {public_key: bufferAsHex(publicKey)});
        }

        return getPublicKey({
          family,
          index: requestDetails.key_index,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Pay the funding request that is locked to the swap hash
      payToFund: ['responseDetails', asyncReflect(({responseDetails}, cbk) => {
        const request = responseDetails.request;

        args.emitter.emit('update', {funding_swap_offchain: request});

        return pay({
          request,
          lnd: args.lnd,
          max_fee: args.max_fee_funding,
        },
        cbk);
      })],

      // Calculate the deadline for the swap on-chain HTLC to confirm
      deadline: ['responseDetails', ({responseDetails}, cbk) => {
        return cbk(null, {
          max_reveal_height: responseDetails.timeout - defaultMinSweepBlocks,
          remaining_ms: defaultWaitForChainFundingMs,
        });
      }],

      // Calculate a starting height for the swap to look for the HTLC output
      startHeight: [
        'getHeight',
        'responseDetails',
        ({getHeight, responseDetails}, cbk) =>
      {
        // Start looking for the on-chain HTLC at around request creation date
        const {request} = responseDetails;

        const createdAt = new Date(parsePaymentRequest({request}).created_at);

        const blocksSinceRequest = ceil((new Date() - createdAt) / minBlockMs);

        return cbk(null, getHeight.current_block_height - blocksSinceRequest);
      }],

      // Derive swap details
      swap: [
        'ecp',
        'getClaimKey',
        'requestDetails',
        'responseDetails',
        ({ecp, getClaimKey, requestDetails, responseDetails}, cbk) =>
      {
        const privateKey = requestDetails.coop_private_key;

        const jointPublicKey = pointAdd(
          ecp.fromPrivateKey(hexAsBuffer(privateKey)).publicKey,
          hexAsBuffer(responseDetails.coop_public_key)
        );

        const swapScript = swapScriptBranches({
          ecp,
          claim_public_key: getClaimKey.public_key,
          hash: sha256(hexAsBuffer(requestDetails.secret)),
          refund_public_key: responseDetails.refund_public_key,
          timeout: responseDetails.timeout,
        });

        const output = v1OutputScript({
          hash: hashForTree({branches: swapScript.branches}).hash,
          internal_key: bufferAsHex(from(jointPublicKey)),
        });

        return cbk(null, {
          claim_script: swapScript.claim,
          external_key: output.external_key,
          internal_key: pubKeyAsInternalKey(jointPublicKey),
          output_script: output.script,
          script_branches: swapScript.branches,
          timeout: responseDetails.timeout,
        });
      }],

      // Lock funds off-chain to the deposit
      payToDeposit: [
        'deadline',
        'ecp',
        'getNetwork',
        'requestDetails',
        'responseDetails',
        'startHeight',
        'swap',
        ({
          deadline,
          ecp,
          getNetwork,
          requestDetails,
          responseDetails,
          startHeight,
          swap,
        },
        cbk) =>
      {
        return asyncRace([
          // Don't bother waiting for the deposit to be taken
          cbk => {
            // Exit early when using explorer API
            if (!!args.request) {
              return findDeposit({
                after: startHeight,
                confirmations: args.min_confirmations || defaultConfsCount,
                network: getNetwork.network,
                output_script: swap.output_script,
                poll_interval_ms: pollInterval[getNetwork.network],
                request: args.request,
                timeout: deadline.remaining_ms,
                tokens: requestDetails.tokens,
              },
              cbk);
            }

            return findConfirmedOutput({
              lnd: args.lnd,
              min_confirmations: args.min_confirmations || defaultConfsCount,
              output_script: swap.output_script,
              start_height: startHeight,
              timeout_ms: deadline.remaining_ms,
              tokens: requestDetails.tokens,
            },
            cbk);
          },

          // Pay to the deposit invoice
          cbk => {
            // The deposit will include the cooperative key for top level key
            const privateKey = hexAsBuffer(requestDetails.coop_private_key);

            const id = responseDetails.coop_private_key_hash;
            const {request} = responseDetails;

            const to = parsePaymentRequest({request});

            args.emitter.emit('update', {paying_execution: id});

            return payViaPaymentDetails({
              id,
              cltv_delta: to.cltv_delta,
              destination: to.destination,
              features: to.features,
              lnd: args.lnd,
              max_fee: args.max_fee_deposit,
              messages: [{
                type: typePayMetadata,
                value: bufferAsHex(ecp.fromPrivateKey(privateKey).publicKey),
              }],
              mtokens: responseDetails.deposit_mtokens,
              payment: responseDetails.deposit_payment,
              routes: to.routes,
            },
            cbk);
          },
        ],
        cbk);
      }],

      // Find the output on chain
      findOutput: [
        'deadline',
        'getNetwork',
        'requestDetails',
        'startHeight',
        'swap',
        ({deadline, getNetwork, requestDetails, startHeight, swap}, cbk) =>
      {
        const [, key] = decompileOutputScript(swap.output_script);
        const outputScript = swap.output_script;
        const prefix = networks[getNetwork.bitcoinjs].bech32;

        const address = encodeAddress(prefix, v1AddressWords(key));

        args.emitter.emit('update', {waiting_for_chain_funding: address});

        if (!!args.request) {
          return findDeposit({
            after: startHeight,
            confirmations: args.min_confirmations || defaultConfsCount,
            network: getNetwork.network,
            output_script: outputScript,
            poll_interval_ms: pollInterval[getNetwork.network],
            request: args.request,
            timeout: deadline.remaining_ms,
            tokens: requestDetails.tokens,
          },
          cbk);
        }

        return findConfirmedOutput({
          lnd: args.lnd,
          min_confirmations: args.min_confirmations || defaultConfsCount,
          output_script: outputScript,
          start_height: startHeight,
          timeout_ms: deadline.remaining_ms,
          tokens: requestDetails.tokens,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, {
            confirm_height: res.confirmation_height,
            transaction_id: res.transaction_id,
            transaction_vout: res.transaction_vout,
          });
        });
      }],

      // Check the found output to make sure it's valid for the swap
      checkOutput: [
        'deadline',
        'findOutput',
        ({deadline, findOutput}, cbk) =>
      {
        args.emitter.emit('update', findOutput);

        // Make sure the HTLC isn't funded from a cb output to avoid maturity
        if (findOutput.is_coinbase) {
          return cbk([501, 'CoinbaseSwapFundingUnsupported']);
        }

        // Make sure the confirmation height is before the deadline
        if (findOutput.confirm_height >= deadline.max_reveal_height) {
          return cbk([503, 'SwapConfirmedTooLateToCompleteOffChain']);
        }

        return cbk();
      }],

      // Generate claim transactions
      claimTxs: [
        'checkOutput',
        'createAddress',
        'deadline',
        'ecp',
        'findOutput',
        'getFeeRate',
        'getNetwork',
        'requestDetails',
        'swap',
        ({
          createAddress,
          deadline,
          ecp,
          findOutput,
          getFeeRate,
          getNetwork,
          requestDetails,
          swap,
        },
        cbk) =>
      {
        const period = deadline.max_reveal_height - findOutput.confirm_height;
        const startRate = getFeeRate.tokens_per_vbyte;

        const multiplier = maxClaimMultiple(startRate, requestDetails.tokens);

        const feeRates = times(period).map(blocks => {
          const {rate} = confirmationFee({
            multiplier,
            before: deadline.max_reveal_height - findOutput.confirm_height,
            cursor: blocks,
            fee: startRate,
          });

          return {
            rate: floor(rate),
            height: findOutput.confirm_height + blocks,
          };
        });

        const claims = uniqBy(feeRates, 'rate').map(({rate, height}) => {
          const {transaction} = taprootClaimTransaction({
            ecp,
            block_height: height,
            claim_script: swap.claim_script,
            external_key: swap.external_key,
            fee_tokens_per_vbyte: rate,
            internal_key: swap.internal_key,
            network: getNetwork.network,
            output_script: swap.output_script,
            private_key: requestDetails.solo_private_key,
            script_branches: swap.script_branches,
            secret: requestDetails.secret,
            sends: [],
            sweep_address: createAddress.address,
            tokens: requestDetails.tokens,
            transaction_id: findOutput.transaction_id,
            transaction_vout: findOutput.transaction_vout,
          });

          return {height, transaction};
        });

        return cbk(null, claims);
      }],

      // Sign claim transactions
      signClaims: [
        'claimTxs',
        'requestDetails',
        'swap',
        ({claimTxs, requestDetails, swap}, cbk) =>
      {
        // Exit early when using a direct private key
        if (!!requestDetails.solo_private_key) {
          return cbk(null, claimTxs);
        }

        return asyncMap(claimTxs, ({height, transaction}, cbk) => {
          return signTransaction({
            transaction,
            inputs: [{
              sighash,
              key_family: family,
              key_index: requestDetails.key_index,
              output_script: swap.output_script,
              output_tokens: requestDetails.tokens,
              vin: sweepInputIndex,
              witness_script: swap.claim_script,
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
              leaf_script: swap.claim_script,
              script_branches: swap.script_branches,
            });

            const witness = [
              requestDetails.secret,
              signature,
              swap.claim_script,
              block,
            ];

            const tx = fromHex(transaction);

            // Add the signature to the sweep
            tx.ins.forEach((input, vin) => {
              return tx.setWitness(vin, witness.map(hexAsBuffer));
            });

            return cbk(null, {height, transaction: tx.toHex()});
          });
        },
        cbk);
      }],

      // Push the preimage to allow for a cooperative swap
      pushPreimage: [
        'ecp',
        'findOutput',
        'requestDetails',
        'responseDetails',
        'signClaims',
        asyncReflect(({
          ecp,
          requestDetails,
          responseDetails,
          signClaims,
        },
        cbk) =>
      {
        const [{transaction}] = signClaims;

        args.emitter.emit('update', {unilateral_claim_tx: transaction});

        // Exit early when performing an uncooperative spend swap
        if (!!args.is_uncooperative) {
          return cbk();
        }

        const privateKey = requestDetails.coop_private_key;
        const to = parsePaymentRequest({request: responseDetails.request});

        const pubKey = ecp.fromPrivateKey(hexAsBuffer(privateKey)).publicKey;

        const id = sha256(pubKey);

        args.emitter.emit('update', {requesting_cooperative_swap: id});

        return payViaPaymentDetails({
          id,
          cltv_delta: to.cltv_delta,
          destination: to.destination,
          features: to.features,
          lnd: args.lnd,
          max_fee: defaultMaxPreimagePushFee,
          payment: responseDetails.push,
          routes: to.routes,
          tokens: tokensForPushPreimage,
          messages: [{type: typePayMetadata, value: requestDetails.secret}],
        },
        err => {
          const [, message] = err;

          if (message !== messageRejected) {
            return cbk([503, 'ExpectedRejectedPaymentFromDestination']);
          }

          args.emitter.emit('update', {coop_request_received: to.destination});

          return cbk();
        });
      })],

      // Get the cooperative key from the settled deposit payment
      findCoopKey: [
        'pushPreimage',
        'responseDetails',
        asyncReflect(({responseDetails}, cbk) =>
      {
        // Exit early not pursuing a cooperative swap flow
        if (!!args.is_avoiding_broadcast || !!args.is_uncooperative) {
          return cbk();
        }

        const id = responseDetails.coop_private_key_hash;

        // Listen for the preimage to arrive from the deposit
        const sub = subscribeToPastPayment({id, lnd: args.lnd});

        // The deposit is expected to resolve after the preimage is pushed
        const timeout = setTimeout(() => {
          sub.removeAllListeners();

          return cbk([503, 'TimedOutWaitingForCooperativeKey']);
        },
        defaultDepositSettleTimeoutMs);

        const done = (err, res) => {
          clearTimeout(timeout);

          sub.removeAllListeners();

          return cbk(err, res);
        };

        // Wait for the deposit to clear
        sub.on('confirmed', ({secret}) => done(null, secret));

        sub.on('error', err => {
          return done([503, 'FailedToFindDepositPayment', {err}]);
        });

        return;
      })],

      // Generate cooperative sweep transactions
      coopTx: [
        'createAddress',
        'deadline',
        'ecp',
        'findCoopKey',
        'findOutput',
        'getFeeRate',
        'getNetwork',
        'payToDeposit',
        'requestDetails',
        'responseDetails',
        'swap',
        asyncReflect(({
          createAddress,
          deadline,
          ecp,
          findCoopKey,
          findOutput,
          getFeeRate,
          getNetwork,
          payToDeposit,
          requestDetails,
          responseDetails,
          swap,
        },
        cbk) =>
      {
        // Exit early when not expecting a cooperative sweep
        if (!!args.is_avoiding_broadcast || !!args.is_uncooperative) {
          return cbk();
        }

        if (!findCoopKey.value) {
          return cbk([503, 'FailedToFindCoopKey']);
        }

        const partnerKey = findCoopKey.value;

        const privateKeysHex = [requestDetails.coop_private_key, partnerKey];

        const privateKeys = privateKeysHex.map(hexAsBuffer);

        const coopKey = ecp.fromPrivateKey(from(privateAdd(...privateKeys)));

        const coopPrivateKey = hexAsBuffer(requestDetails.coop_private_key);

        const jointPublicKey = pointAdd(
          ecp.fromPrivateKey(coopPrivateKey).publicKey,
          hexAsBuffer(responseDetails.coop_public_key)
        );

        // The public key from the private keys should be the combined pubkeys
        if (!coopKey.publicKey.equals(jointPublicKey)) {
          return cbk([503, 'ReceivedIncorrectPrivateCoopKey']);
        }

        const period = deadline.max_reveal_height - findOutput.confirm_height;
        const startRate = getFeeRate.tokens_per_vbyte;

        const multiplier = maxCoopMultiple(startRate, requestDetails.tokens);

        const feeRates = times(period).map(blocks => {
          const {rate} = confirmationFee({
            multiplier,
            before: deadline.max_reveal_height - findOutput.confirm_height,
            cursor: blocks,
            fee: startRate,
          });

          return {
            height: findOutput.confirm_height + blocks,
            rate: floor(rate),
          };
        });

        // Derive sweep transactions at different fee rates
        const coop = feeRates.map(({height, rate}) => {
          const {transaction} = taprootCoopTransaction({
            ecp,
            fee_tokens_per_vbyte: rate,
            network: getNetwork.network,
            output_script: swap.output_script,
            private_keys: privateKeysHex,
            script_branches: swap.script_branches,
            sweep_address: createAddress.address,
            tokens: requestDetails.tokens,
            transaction_id: findOutput.transaction_id,
            transaction_vout: findOutput.transaction_vout,
          });

          return {height, transaction};
        });

        const [{transaction}] = coop;

        args.emitter.emit('update', {cooperative_claim_tx: transaction});

        return cbk(null, coop);
      })],

      // Sweeps to publish
      sweeps: [
        'coopTx',
        'findOutput',
        'signClaims',
        'swap',
        ({coopTx, findOutput, signClaims, swap}, cbk) =>
      {
        return cbk(null, {
          confirm_height: findOutput.confirm_height,
          output_script: swap.output_script,
          transactions: coopTx.value || signClaims,
          transaction_id: findOutput.transaction_id,
          transaction_vout: findOutput.transaction_vout,
        });
      }],

      // Publish the sweeps
      publish: [
        'findOutput',
        'getNetwork',
        'swap',
        'sweeps',
        ({findOutput, getNetwork, swap, sweeps}, cbk) =>
      {
        // Exit early when avoiding broadcast of the sweep
        if (!!args.is_avoiding_broadcast) {
          return cbk();
        }

        const subBlocks = subscribeToBlocks({lnd: args.lnd});

        const subSpend = subscribeToSpend({
          delay_ms: pollInterval[getNetwork.network],
          lnd: args.lnd,
          min_height: findOutput.confirm_height - fuzzBlocks,
          network: getNetwork.network,
          output_script: swap.output_script,
          request: args.request,
          transaction_id: findOutput.transaction_id,
          transaction_vout: findOutput.transaction_vout,
        });

        const done = (err, res) => {
          subBlocks.removeAllListeners();
          subSpend.removeAllListeners();

          return cbk(err, res);
        };

        const [start] = sweeps.transactions;

        // Broadcast sweeps into a block
        subBlocks.on('block', block => {
          const broadcast = sweeps.transactions.filter(sweep => {
            return sweep.height <= block.height;
          });

          if (!broadcast.length) {
            return;
          }

          const [{transaction}] = broadcast.reverse();

          args.emitter.emit('update', {
            blocks_until_potential_funds_forfeit: swap.timeout - block.height,
            broadcasting_tx_to_resolve_swap: transaction,
            broadcasting_tx_id: fromHex(transaction).getId(),
          });

          return broadcastChainTransaction({
            transaction,
            lnd: args.lnd,
          },
          err => {});
        });

        subBlocks.on('error', err => done(err));

        // Look for the sweep to confirm
        subSpend.on('confirmation', ({transaction}) => {
          return done(null, fromHex(transaction).getId());
        });

        subSpend.on('error', err => done(err));

        return;
      }],

      // Get the funding payment
      getFunding: ['responseDetails', 'publish', ({responseDetails}, cbk) => {
        const {id} = parsePaymentRequest({request: responseDetails.request});

        return getPayment({id, lnd: args.lnd}, cbk);
      }],

      // Get the execution payment
      getDeposit: ['responseDetails', 'publish', ({responseDetails}, cbk) => {
        const id = responseDetails.coop_private_key_hash;

        return getPayment({id, lnd: args.lnd}, cbk);
      }],

      // Summarize swap
      summary: [
        'getFunding',
        'getDeposit',
        ({getFunding, getDeposit}, cbk) =>
      {
        const deposit = getDeposit.payment || {};
        const funding = getFunding.payment || {};

        return cbk(null, {
          paid_execution_fee: deposit.tokens,
          paid_execution_routing: deposit.fee,
          swap_payment_sent: funding.tokens,
          swap_payment_routing_fee: funding.fee,
        });
      }],
    },
    returnResult({reject, resolve, of: 'summary'}, cbk));
  });
};
