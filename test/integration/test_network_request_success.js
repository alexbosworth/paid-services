const {deepStrictEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const test = require('node:test');

const asyncRetry = require('async/retry');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {createNetworkPath} = require('./../../network');
const {makeNetworkRequest} = require('./../../network');
const {serviceNetworkRequests} = require('./../../network');

const capacity = 1e6;
const interval = 100;
const records = [{type: '1', value: '01'}];
const size = 2;
const timeout = 1000 * 5;
const type = '0';

// A request on an accepted path should get a success response
test(`Network request gets a success response`, async () => {
  const {kill, nodes} = await spawnLightningCluster({capacity, size});

  // The client has a channel to the server
  const [client, server] = nodes;

  // Listeners to stop when the test is done
  const listeners = [];

  try {
    // The server publishes a blinded path to itself for clients to use
    const published = await createNetworkPath({lnd: server.lnd});

    // Start the server and respond to requests on the published path
    const listener = serviceNetworkRequests({
      ids: [published.id],
      lnd: server.lnd,
    });

    listeners.push(listener);

    const pathIds = [];

    listener.request({type}, (req, res) => {
      pathIds.push(req.path_id);

      return res.success({records});
    });

    const got = await asyncRetry({interval, times: 10}, cbk => {
      return makeNetworkRequest({
        timeout,
        type,
        lnd: client.lnd,
        path: published.path,
      },
      cbk);
    });

    deepStrictEqual(got.records, records, 'Got response records');

    // Retried requests can arrive more than once, all on the published path
    equal(!!pathIds.length, true, 'Request arrived at server');
    equal(pathIds.every(n => n === published.id), true, 'Arrived on path');
  } finally {
    // Stop listening before the nodes go away
    listeners.forEach(n => n.stop({}));

    // Clean up the nodes even when the test fails
    await kill({});
  }
});
