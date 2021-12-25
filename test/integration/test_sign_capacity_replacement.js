const {address} = require('bitcoinjs-lib');
const asyncMap = require('async/map');
const asyncRetry = require('async/retry');
const {broadcastChainTransaction} = require('ln-service');
const {closeChannel} = require('ln-service');
const {createChainAddress} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getChannels} = require('ln-service');
const {networks} = require('bitcoinjs-lib');
const {openChannel} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {test} = require('@alexbosworth/tap');
const {Transaction} = require('bitcoinjs-lib');

const finalize = require('./../../capacity/finalize_capacity_replacement');
const method = require('./../../capacity/sign_capacity_replacement');

const bufferAsHex = buffer => buffer.toString('hex');
const capacity = 1e6;
const finalizeCapacityReplacement = finalize;
const {fromHex} = Transaction;
const interval = 10;
const maturity = 100;
const network = networks.regtest;
const sequence = 0;
const signCapacityReplacement = method;
const size = 2;
const sumOf = arr => arr.reduce((sum, n) => sum + n, 0);
const times = 2000;
const {toOutputScript} = address;
const weightAsVBytes = n => Math.ceil(n / 4);

// Signing a capacity replacement transaction should result in a valid sig
test(`Sign capacity replacement`, async ({end, equal, strictSame}) => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [{generate, lnd}, target] = nodes;

  await generate({count: maturity});

  try {
    // Open up a new channel
    const channelOpen = await openChannel({
      lnd,
      local_tokens: capacity,
      partner_public_key: target.id,
      partner_socket: target.socket,
    });

    // Wait for the channel to be active
    const channel = await asyncRetry({interval, times}, async () => {
      const [channel] = (await getChannels({lnd, is_active: true})).channels;

      if (!!channel) {
        return channel;
      }

      await generate({});

      throw new Error('ExpectedChannelActivation');
    });

    // Find the open tx
    const tx = (await getChainTransactions({lnd})).transactions.find(tx => {
      return tx.id === channel.transaction_id;
    });

    // Get the open tx output
    const output = fromHex(tx.transaction).outs[channel.transaction_vout];

    // Close the channel
    const channelClose = await closeChannel({
      lnd,
      id: channel.id,
      is_force_close: true,
    });

    // Find the open tx
    const endTx = (await getChainTransactions({lnd})).transactions.find(tx => {
      return tx.id === channelClose.transaction_id;
    });

    // Get the witness spending the channel funds
    const [{witness}] = fromHex(endTx.transaction).ins;

    const replacement = new Transaction();

    const openTxHash = fromHex(tx.transaction).getHash();

    replacement.addInput(openTxHash, channel.transaction_vout, sequence);

    const spendIdx = replacement.ins.findIndex(n => n.hash.equals(openTxHash));

    const fee = sumOf([
      channel.commit_transaction_fee,
      weightAsVBytes(channel.commit_transaction_weight),
    ]);

    replacement.addOutput(
      toOutputScript((await createChainAddress({lnd})).address, network),
      channel.capacity - fee,
    );

    // Gather the replacement signatures
    const [local, remote] = await asyncMap([lnd, target.lnd], async lnd => {
      return await signCapacityReplacement({
        lnd,
        capacity: channel.capacity,
        output: bufferAsHex(output.script),
        script: bufferAsHex(witness.slice().pop()),
        transaction: replacement.toHex(),
        vin: replacement.ins.findIndex(n => n.hash.equals(openTxHash)),
      });
    });

    // Add the signature to the replacement transaction
    const {transaction} = finalizeCapacityReplacement({
      local_public_key: local.key,
      local_signature: local.signature,
      funding_spend_vin: spendIdx,
      remote_signature: remote.signature,
      transaction: replacement.toHex(),
      witness_script: bufferAsHex(witness.slice().pop()),
    });

    await broadcastChainTransaction({transaction, lnd});

    await generate({count: maturity});

    const done = (await getChainTransactions({lnd})).transactions.find(tx => {
      return tx.id === fromHex(transaction).getId();
    });

    strictSame(done.is_confirmed, true, 'Signed replacement is confirmed');
  } catch (err) {
    strictSame(err, null, 'Expected no failure');
  } finally {
    await kill({});
  }

  return end();
});
