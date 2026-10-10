const {deepStrictEqual} = require('node:assert').strict;
const test = require('node:test');

const asyncRetry = require('async/retry');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {createNetworkPath} = require('./../../network');
const {makeNetworkRequest} = require('./../../network');
const {serviceNetworkRequests} = require('./../../network');

const capacity = 1e6;
const confirmations = 6;
const interval = 1000;
const records = [{type: '1', value: '01'}];
const size = 3;
const timeout = 1000 * 5;
const times = 60;
const type = '0';

// Requests and replies should be routed to nodes that are not connected peers
test(`Network request routed through the graph`, async () => {
  const {kill, nodes} = await spawnLightningCluster({capacity, size});

  // The client and the server are only linked through the relay node
  const [client, relay, server] = nodes;

  // Listeners to stop when the test is done
  const listeners = [];

  try {
    // Confirm the channels enough for them to be announced
    await client.generate({count: confirmations});

    const listener = serviceNetworkRequests({lnd: server.lnd});

    listeners.push(listener);

    listener.request({type}, (req, res) => res.success({records}));

    const {path} = await createNetworkPath({lnd: server.lnd});

    // Retry until the channels have been gossiped to the graph
    const got = await asyncRetry({interval, times}, cbk => {
      return makeNetworkRequest({
        path,
        timeout,
        type,
        lnd: client.lnd,
      },
      cbk);
    });

    deepStrictEqual(got.records, records, 'Got response routed via relay');
  } finally {
    // Stop listening before the nodes go away
    listeners.forEach(n => n.stop({}));

    // Clean up the nodes even when the test fails
    await kill({});
  }
});
