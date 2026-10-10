const {deepStrictEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {addPeer} = require('ln-service');
const asyncRetry = require('async/retry');
const {getPeers} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {makePeerRequest} = require('./../../');
const {servicePeerRequests} = require('./../../');

const failure = [402, 'PurchaseRequired'];
const failureType = '1';
const interval = 100;
const records = [{type: '1', value: '01'}];
const size = 2;
const times = 3000;
const type = '0';

// Adding a listener for peer requests should allow responding to peer requests
test(`Listen for peer requests`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size});

  // Listeners to stop when the test is done
  const listeners = [];

  try {
    const [{id, lnd}, target] = nodes;

    await asyncRetry({interval, times}, async () => {
      await addPeer({lnd, public_key: target.id, socket: target.socket});
    });

    // The connection can be known to the server before the target knows it,
    // and the target can only send requests to a peer that it knows
    await asyncRetry({interval, times}, async () => {
      const {peers} = await getPeers({lnd: target.lnd});

      if (!peers.find(peer => peer.public_key === id)) {
        throw new Error('WaitingForTargetToConnectToServer');
      }
    });

    // Start the server and respond to requests
    const listener = servicePeerRequests({lnd});

    listeners.push(listener);

    listener.request({type}, (req, res) => res.success({records}));
    listener.request({type: failureType}, (req, res) => res.failure(failure));

    // Make a request to the server and get a success response
    const got = await makePeerRequest({
      type,
      lnd: target.lnd,
      timeout: 1000,
      to: id,
    });

    deepStrictEqual(records, got.records, 'Got response records');

    // Make a request to the server and get a failure response
    const failed = makePeerRequest({
      type: failureType,
      lnd: target.lnd,
      timeout: 1000,
      to: id,
    });

    await rejects(failed, failure, 'Got failure response for failure type');
  } finally {
    // Stop listening before the nodes go away
    listeners.forEach(n => n.stop({}));

    await kill({});
  }
});
