const {rejects} = require('node:assert').strict;
const test = require('node:test');

const asyncRetry = require('async/retry');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {createNetworkPath} = require('./../../network');
const {makeNetworkRequest} = require('./../../network');
const {serviceNetworkRequests} = require('./../../network');

const capacity = 1e6;
const failure = [402, 'PurchaseRequired'];
const interval = 100;
const isTimeout = err => err[1] === 'NetworkRequestTimeout';
const size = 2;
const timeout = 1000 * 5;
const type = '1';

// A request the server fails should get the failure back
test(`Network request gets a failure response`, async () => {
  const {kill, nodes} = await spawnLightningCluster({capacity, size});

  // The client has a channel to the server
  const [client, server] = nodes;

  // Listeners to stop when the test is done
  const listeners = [];

  try {
    const {id, path} = await createNetworkPath({lnd: server.lnd});

    const listener = serviceNetworkRequests({ids: [id], lnd: server.lnd});

    listeners.push(listener);

    listener.request({type}, (req, res) => res.failure(failure));

    // Retry while the request times out, until the failure comes back
    const request = asyncRetry({
      interval,
      errorFilter: isTimeout,
      times: 10,
    },
    cbk => {
      return makeNetworkRequest({path, timeout, type, lnd: client.lnd}, cbk);
    });

    await rejects(request, failure, 'Got failure response');
  } finally {
    // Stop listening before the nodes go away
    listeners.forEach(n => n.stop({}));

    // Clean up the nodes even when the test fails
    await kill({});
  }
});
