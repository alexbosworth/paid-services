const {deepStrictEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
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
const timedOut = [0, 'NetworkRequestTimeout'];
const timeout = 1000 * 5;
const type = '0';

// A request on a path the server does not accept should be ignored
test(`Network request on an unaccepted path is ignored`, async () => {
  const {kill, nodes} = await spawnLightningCluster({capacity, size});

  // The client has a channel to the server
  const [client, server] = nodes;

  // Listeners to stop when the test is done
  const listeners = [];

  try {
    const accepted = await createNetworkPath({lnd: server.lnd});

    // A path the server created but does not accept requests on
    const unaccepted = await createNetworkPath({lnd: server.lnd});

    const listener = serviceNetworkRequests({
      ids: [accepted.id],
      lnd: server.lnd,
    });

    listeners.push(listener);

    listener.request({type}, (req, res) => res.success({records}));

    // A request on the accepted path shows that the server is answering
    const got = await asyncRetry({interval, times: 10}, cbk => {
      return makeNetworkRequest({
        timeout,
        type,
        lnd: client.lnd,
        path: accepted.path,
      },
      cbk);
    });

    deepStrictEqual(got.records, records, 'Got response on accepted path');

    const request = makeNetworkRequest({
      timeout,
      type,
      lnd: client.lnd,
      path: unaccepted.path,
    });

    await rejects(request, timedOut, 'Request on unaccepted path ignored');
  } finally {
    // Stop listening before the nodes go away
    listeners.forEach(n => n.stop({}));

    // Clean up the nodes even when the test fails
    await kill({});
  }
});
