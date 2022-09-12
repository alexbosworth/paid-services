const {createHash} = require('crypto');
const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncMapSeries = require('async/mapSeries');
const asyncRace = require('async/race');
const asyncReflect = require('async/reflect');
const asyncTimeout = require('async/timeout');
const {bech32m} = require('bech32');
const {beginGroupSigningSession} = require('ln-service');
const {broadcastChainTransaction} = require('ln-service');
const {cancelSwapOut} = require('goldengate');
const {confirmationFee} = require('goldengate');
const {controlBlock} = require('p2tr');
const {createChainAddress} = require('ln-service');
const {diffieHellmanComputeSecret} = require('ln-service');
const {findConfirmedOutput} = require('ln-sync');
const {findDeposit} = require('goldengate');
const {getChainFeeRate} = require('ln-service');
const {getCoopSignedTx} = require('goldengate');
const {getHeight} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getPayment} = require('ln-service');
const {getPublicKey} = require('ln-service');
const {hashForTree} = require('p2tr');
const {lightningLabsSwapAuth} = require('goldengate');
const {lightningLabsSwapService} = require('goldengate');
const {networks} = require('bitcoinjs-lib');
const {parsePaymentRequest} = require('ln-service');
const {pay} = require('ln-service');
const {payViaPaymentDetails} = require('ln-service');
const {pointAdd} = require('tiny-secp256k1');
const {privateAdd} = require('tiny-secp256k1');
const {releaseSwapOutSecret} = require('goldengate');
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

const decodeLoopResponse = require('./decode_loop_response');
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
const externalKeyAsOutputScript = key => `5120${key}`;
const family = 805;
const {floor} = Math;
const {from} = Buffer;
const {fromHex} = Transaction;
const fuzzBlocks = 100;
const fuzzTimelock = 1;
const getLoopCoopSignedTransaction = asyncTimeout(getCoopSignedTx, 1000 * 30);
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;
const maxClaimMultiple = (r, t) => Math.min(1000, ((1000 + t) / 150) / r);
const maxCoopMultiple = (r, t) => Math.min(1000, ((1000 + t) / 100) / r);
const messageRejected = 'PaymentRejectedByDestination';
const {min} = Math;
const minTokens = 10000;
const minBlockMs = 1000 * 60;
const pollInterval = {btcregtest: 100};
const ppmRate = (fee, total) => fee * 1e6 / total.tokens;
const preimageByteLength = 32;
const pubKeyAsInternalKey = key => Buffer.from(key).slice(1).toString('hex');
const pushSecret = asyncTimeout(releaseSwapOutSecret, 1000 * 30);
const sha256 = preimage => createHash('sha256').update(preimage).digest('hex');
const sighash = Transaction.SIGHASH_DEFAULT;
const slowConfs = 144 * 7;
const sumOf = arr => arr.reduce((sum, n) => sum + n, 0);
const sweepInputIndex = 0;
const times = n => Array(n).fill(null).map((_, i) => i);
const tokensForPushPreimage = 1;
const uniqBy = (a,b) => a.filter((e,i) => a.findIndex(n => n[b] == e[b]) == i);
const v1AddressWords = key => [].concat(1).concat(bech32m.toWords(key));

/** Complete the off to on swap

  {
    emitter: <Event Emitter Object>
    [is_avoiding_broadcast]: <Avoid Sweep Broadcast Bool>
    [is_external_funding]: <Externally Fund Swap Bool>
    [is_loop_service]: <Complete Swap With Lightning Loop Service Bool>
    [is_uncooperative]: <Avoid Cooperative Signing Bool>
    lnd: <Autenticated LND API Object>
    max_fee_deposit: <Max Routing Fee Tokens For Deposit Number>
    max_fee_funding: <Max Routing Fee Tokens For Funding Number>
    [min_confirmations]: <Confirmation Blocks Number>
    recovery: <Swap Request Recovery Hex String>
    [request]: <Request Function>
    response: <Swap Response Hex String>
    [sweep_address]: <Sweep Chain Address String>
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
        // Exit early when there is no need to create a sweep address
        if (!!args.sweep_address) {
          return cbk(null, {address: args.sweep_address});
        }

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
      responseDetails: [
        'getNetwork',
        'requestDetails',
        ({getNetwork, requestDetails}, cbk) =>
      {
        // Exit early when using the Lightning Loop service
        if (!!args.is_loop_service) {
          try {
            const details = decodeLoopResponse({
              network: getNetwork.bitcoinjs,
              response: args.response,
            });

            return cbk(null, {
              auth_macaroon: details.auth_macaroon,
              auth_preimage: details.auth_preimage,
              deposit_id: details.deposit_id,
              deposit_request: details.deposit_request,
              funding_hash: details.fund_id,
              funding_payment: details.fund_payment,
              request: details.fund_request,
              refund_public_key: details.remote_public_key,
              timeout: details.timeout,
            });
          } catch (err) {
            return cbk([400, 'FailedToDecodeLoopResponseDetails', {err}]);
          }
        }

        try {
          // Decode the response
          const decoded = decodeOffToOnResponse({
            network: getNetwork.bitcoinjs,
            response: args.response,
          });

          return cbk(null, {
            coop_private_key_hash: decoded.coop_private_key_hash,
            coop_public_key: decoded.coop_public_key,
            deposit_id: decoded.coop_private_key_hash,
            deposit_mtokens: decoded.deposit_mtokens,
            deposit_payment: decoded.deposit_payment,
            incoming_peer: decoded.incoming_peer,
            push: decoded.push,
            refund_public_key: decoded.refund_public_key,
            request: decoded.request,
            timeout: decoded.timeout,
          });
        } catch (err) {
          return cbk([400, 'FailedToDecodeResponseDetails', {err}]);
        }
      }],

      // Get the deposit payment details
      getDepositPayment: ['responseDetails', ({responseDetails}, cbk) => {
        const id = responseDetails.coop_private_key_hash;
        const request = responseDetails.deposit_request;

        return getPayment({
          id: id || parsePaymentRequest({request}).id,
          lnd: args.lnd,
        },
        (err, res) => {
          // Ignore payment not found errors
          if (isArray(err) && err.slice().shift() === 404) {
            return cbk(null, {});
          }

          return cbk(err, res);
        });
      }],

      // Get the funding payment details
      getFundPayment: ['responseDetails', ({responseDetails}, cbk) => {
        return getPayment({
          id: parsePaymentRequest({request: responseDetails.request}).id,
          lnd: args.lnd,
        },
        (err, res) => {
          // Ignore payment not found errors
          if (isArray(err) && err.slice().shift() === 404) {
            return cbk(null, {});
          }

          return cbk(err, res);
        });
      }],

      // Check that the swap id matches the request
      checkSwapId: [
        'requestDetails',
        'responseDetails',
        ({requestDetails, responseDetails}, cbk) =>
      {
        const request = responseDetails.request;
        const swapId = sha256(hexAsBuffer(requestDetails.secret));

        if (parsePaymentRequest({request}).id !== swapId) {
          return cbk([400, 'IncorrectSwapResponseForSwapRequest']);
        }

        return cbk();
      }],

      // Initiate the Loop service connection for swap cosigning and releases
      loopService: [
        'getNetwork',
        'responseDetails',
        ({getNetwork, responseDetails}, cbk) =>
      {
        // Exit early when not using the Lightning Loop service
        if (!args.is_loop_service) {
          return cbk();
        }

        const {metadata} = lightningLabsSwapAuth({
          macaroon: responseDetails.auth_macaroon,
          preimage: responseDetails.auth_preimage,
        });

        const {service} = lightningLabsSwapService({
          network: getNetwork.network,
        });

        return cbk(null, {metadata, service});
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
      payToFund: [
        'checkSwapId',
        'getFundPayment',
        'responseDetails',
        asyncReflect(({getFundPayment, responseDetails}, cbk) =>
      {
        // Exit early when the payment is pending
        if (!!getFundPayment.payment || !!getFundPayment.pending) {
          return cbk();
        }

        const request = responseDetails.request;

        // Exit early when not paying to fund in-flow
        if (!!args.is_external_funding) {
          args.emitter.emit('update', {
            external_funding_pay_to_fund_swap_offchain: request,
            must_be_in_through: responseDetails.incoming_peer || undefined,
          });

          return cbk();
        }

        args.emitter.emit('update', {funding_swap_offchain: request});

        return pay({
          request,
          incoming_peer: responseDetails.incoming_peer || undefined,
          lnd: args.lnd,
          max_fee: args.max_fee_funding,
        },
        cbk);
      })],

      // Cancel the swap when funding fails to release the deposit hold
      cancelSwap: [
        'loopService',
        'payToFund',
        'responseDetails',
        ({loopService, payToFund, responseDetails}, cbk) =>
      {
        // Exit early when not using Lightning Loop and no way to cancel swap
        if (!args.is_loop_service) {
          return cbk(payToFund.error);
        }

        // Exit early when there is no need to cancel the swap
        if (!payToFund.error) {
          return cbk();
        }

        const fund = parsePaymentRequest({request: responseDetails.request});

        return cancelSwapOut({
          id: fund.id,
          metadata: loopService.metadata,
          payment: fund.payment,
          service: loopService.service,
        },
        err => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(payToFund.error);
        });
      }],

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

      // Derive the swap script branches
      branches: [
        'ecp',
        'getClaimKey',
        'requestDetails',
        'responseDetails',
        ({ecp, getClaimKey, requestDetails, responseDetails}, cbk) =>
      {
        const swapScript = swapScriptBranches({
          ecp,
          claim_public_key: getClaimKey.public_key,
          hash: sha256(hexAsBuffer(requestDetails.secret)),
          refund_public_key: responseDetails.refund_public_key,
          timeout: responseDetails.timeout,
        });

        return cbk(null, {
          branches: swapScript.branches,
          claim: swapScript.claim,
          hash: hashForTree({branches: swapScript.branches}).hash,
          timeout: responseDetails.timeout,
        });
      }],

      // Derive the output script
      joined: [
        'ecp',
        'branches',
        'getClaimKey',
        'requestDetails',
        'responseDetails',
        ({ecp, branches, getClaimKey, requestDetails, responseDetails}, cbk) =>
      {
        // Exit early when using MuSig2 with Lightning Loop
        if (!!args.is_loop_service) {
          return beginGroupSigningSession({
            lnd: args.lnd,
            key_family: family,
            key_index: requestDetails.key_index,
            public_keys: [
              getClaimKey.public_key,
              responseDetails.refund_public_key,
            ],
            root_hash: branches.hash,
          },
          cbk);
        }

        const privateKey = requestDetails.coop_private_key;

        const jointPublicKey = pointAdd(
          ecp.fromPrivateKey(hexAsBuffer(privateKey)).publicKey,
          hexAsBuffer(responseDetails.coop_public_key)
        );

        const output = v1OutputScript({
          hash: branches.hash,
          internal_key: bufferAsHex(from(jointPublicKey)),
        });

        return cbk(null, {
          external_key: output.external_key,
          internal_key: pubKeyAsInternalKey(jointPublicKey),
          output_script: output.script,
        });
      }],

      // Overall swap details
      swap: ['branches', 'joined', ({branches, joined}, cbk) => {
        // Exit early when using Lightning Loop swap service
        if (!!args.is_loop_service) {
          const output = v1OutputScript({
            hash: branches.hash,
            internal_key: joined.internal_key,
          });

          return cbk(null, {
            claim_script: branches.claim,
            external_key: output.external_key,
            internal_key: joined.internal_key,
            output_script: externalKeyAsOutputScript(joined.external_key),
            script_branches: branches.branches,
            timeout: branches.timeout,
          });
        }

        return cbk(null, {
          claim_script: branches.claim,
          external_key: joined.external_key,
          internal_key: joined.internal_key,
          output_script: joined.output_script,
          script_branches: branches.branches,
          timeout: branches.timeout,
        });
      }],

      // Lock funds off-chain to the deposit
      payToDeposit: [
        'checkSwapId',
        'deadline',
        'ecp',
        'getDepositPayment',
        'getNetwork',
        'requestDetails',
        'responseDetails',
        'startHeight',
        'swap',
        ({
          deadline,
          ecp,
          getNetwork,
          getDepositPayment,
          requestDetails,
          responseDetails,
          startHeight,
          swap,
        },
        cbk) =>
      {
        // Exit early when deposit payment is already existing
        if (!!getDepositPayment.payment || !!getDepositPayment.pending) {
          return cbk();
        }

        const request = responseDetails.deposit_request;

        if (!!args.is_external_funding && !!args.is_loop_service) {
          args.emitter.emit('update', {external_pay_deposit_request: request});

          return cbk();
        }

        // Exit early when using the Lightning Loop service
        if (!!args.is_loop_service) {
          return pay({
            request,
            max_fee: args.max_fee_deposit,
            lnd: args.lnd,
          },
          err => {
            if (!!err) {
              return cbk([503, 'UnexpectedErrorOnDepositPayment', {err}]);
            }

            return cbk();
          });
        }

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

            // Look for the HTLC output on chain
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
              incoming_peer: requestDetails.incoming_peer || undefined,
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
            err => {
              // Exit early when there is no error paying the deposit
              if (!err) {
                return cbk();
              }

              const [, message] = err;

              // Exit early and ignore rejections from the destination
              if (message === 'PaymentRejectedByDestination') {
                return cbk();
              }

              return cbk(err);
            });
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

        args.emitter.emit('update', {
          waiting_for_chain_funding: address,
          required_confirmations: args.min_confirmations || defaultConfsCount,
        });

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
        const rates = {};
        const startRate = getFeeRate.tokens_per_vbyte;

        const multiplier = maxClaimMultiple(startRate, requestDetails.tokens);

        const feeRates = times(period).map(blocks => {
          const {rate} = confirmationFee({
            multiplier,
            before: deadline.max_reveal_height - findOutput.confirm_height,
            cursor: blocks,
            fee: startRate,
          });

          const feeRate = floor(rate);

          return {rate: feeRate, height: findOutput.confirm_height + blocks};
        });

        const claims = feeRates.map(({rate, height}) => {
          const {transaction} = taprootClaimTransaction({
            ecp,
            block_height: height - fuzzTimelock,
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

          if (!!rates[rate]) {
            return;
          }

          rates[rate] = true;

          return {height, transaction};
        });

        return cbk(null, claims.filter(n => !!n));
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

        args.emitter.emit('update', {signing_unilateral_claim_tx: true});

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
        'loopService',
        'requestDetails',
        'responseDetails',
        'signClaims',
        asyncReflect(({
          ecp,
          loopService,
          requestDetails,
          responseDetails,
          signClaims,
        },
        cbk) =>
      {
        const [{transaction}] = signClaims;

        args.emitter.emit('update', {unilateral_claim_tx: transaction});

        // Exit early when pushing the preimage to the Lightning Loop service
        if (!!args.is_loop_service) {
          args.emitter.emit('update', {releasing_funds: true});

          return pushSecret({
            is_taproot: true,
            metadata: loopService.metadata,
            secret: requestDetails.secret,
            service: loopService.service,
          },
          err => {
            if (!!err) {
              return cbk([503, 'UnexpectedErrorPushingSwapSecret', {err}]);
            }

            return cbk();
          });
        }

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
        // Exit early when not needing the coop key for Lightning Loop request
        if (!!args.is_loop_service) {
          return cbk();
        }

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
        'branches',
        'createAddress',
        'deadline',
        'ecp',
        'findCoopKey',
        'findOutput',
        'getClaimKey',
        'getFeeRate',
        'getNetwork',
        'loopService',
        'payToDeposit',
        'requestDetails',
        'responseDetails',
        'swap',
        asyncReflect(({
          branches,
          createAddress,
          deadline,
          ecp,
          findCoopKey,
          findOutput,
          getClaimKey,
          getFeeRate,
          getNetwork,
          loopService,
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

        const period = deadline.max_reveal_height - findOutput.confirm_height;
        const rates = {};
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

        // Exit early when using MuSig2 with Loop service
        if (!!args.is_loop_service) {
          args.emitter.emit('update', {requesting_coop_signatures: true});

          return asyncMapSeries(feeRates, ({height, rate}, cbk) => {
            // Exit early when this rate is already signed for
            if (!!rates[rate]) {
              return cbk();
            }

            // Skip signing for this rate in the future
            rates[rate] = true;

            return getLoopCoopSignedTransaction({
              fee_tokens_per_vbyte: rate,
              funding_hash: responseDetails.funding_hash,
              funding_payment: responseDetails.funding_payment,
              key_family: family,
              key_index: requestDetails.key_index,
              lnd: args.lnd,
              metadata: loopService.metadata,
              network: getNetwork.network,
              output_script: swap.output_script,
              public_keys: [
                getClaimKey.public_key,
                responseDetails.refund_public_key,
              ],
              root_hash: branches.hash,
              script_branches: swap.script_branches,
              service: loopService.service,
              sweep_address: createAddress.address,
              tokens: requestDetails.tokens,
              transaction_id: findOutput.transaction_id,
              transaction_vout: findOutput.transaction_vout,
            },
            (err, res) => {
              if (!!err) {
                return cbk([503, 'UnexpecctedErrorGettingCoopSign', {err}]);
              }

              return cbk(null, {height, transaction: res.transaction});
            });
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, res.filter(n => !!n));
          });
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
        'requestDetails',
        'swap',
        'sweeps',
        ({findOutput, getNetwork, requestDetails, swap, sweeps}, cbk) =>
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

          const tx = fromHex(transaction);

          const fee = requestDetails.tokens - sumOf(tx.outs.map(n => n.value));

          args.emitter.emit('update', {
            blocks_until_potential_funds_forfeit: swap.timeout - block.height,
            broadcasting_fee_rate: fee / tx.virtualSize(),
            broadcasting_tx_to_resolve_swap: transaction,
            broadcasting_tx_id: tx.getId(),
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
          const tx = fromHex(transaction);

          const fee = requestDetails.tokens - sumOf(tx.outs.map(n => n.value));

          return done(null, {fee: fee, rate: fee / tx.virtualSize()});
        });

        subSpend.on('error', err => done(err));

        return;
      }],

      // Get the funding payment if a funding payment was made
      getFunding: ['responseDetails', 'publish', ({responseDetails}, cbk) => {
        const {id} = parsePaymentRequest({request: responseDetails.request});

        return getPayment({id, lnd: args.lnd}, cbk);
      }],

      // Get the execution payment to see what was paid and what fee
      getDeposit: ['responseDetails', 'publish', ({responseDetails}, cbk) => {
        return getPayment({
          id: responseDetails.deposit_id,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Summarize swap
      summary: [
        'getFunding',
        'getDeposit',
        'publish',
        'requestDetails',
        ({getFunding, getDeposit, publish, requestDetails}, cbk) =>
      {
        const deposit = getDeposit.payment || {};
        const funding = getFunding.payment || {};

        const paid = [deposit.tokens, funding.tokens].filter(n => !!n);
        const routing = [deposit.fee, funding.fee].filter(n => !!n);

        const destinationFee = sumOf(paid) - requestDetails.tokens;

        const allFees = destinationFee + sumOf(routing) + publish.fee;

        return cbk(null, {
          paid_chain_fee: publish.fee,
          paid_execution_routing_fee: deposit.fee || undefined,
          paid_funding_routing_fee: funding.fee || undefined,
          paid_swap_fee: destinationFee || undefined,
          total_fee: allFees,
          total_fee_rate: ppmRate(allFees, requestDetails.tokens),
          transaction_fee_rate: publish.rate,
        });
      }],
    },
    returnResult({reject, resolve, of: 'summary'}, cbk));
  });
};
