const {addPeer} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {test} = require('@alexbosworth/tap');

const {makePeerRequest} = require('./../../');
const {servicePeerRequests} = require('./../../');

const failure = [402, 'PurchaseRequired'];
const failureType = '1';
const records = [{type: '1', value: '01'}];
const size = 2;
const type = '0';

// Adding a listener for peer requests should allow responding to peer requests
test(`Listen for peer requests`, async ({end, equal, strictSame}) => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [{id, lnd}, target] = nodes;

  await addPeer({lnd, public_key: target.id, socket: target.socket});

  // Start the server and respond to requests
  const listener = servicePeerRequests({lnd});

  listener.request({type}, (req, res) => res.success({records}));
  listener.request({type: failureType}, (req, res) => res.failure(failure));

  // Make a request to the server and get a success response
  try {
    const got = await makePeerRequest({
      type,
      lnd: target.lnd,
      timeout: 1000,
      to: id,
    });

    strictSame(records, got.records, 'Got response records');
  } catch (err) {
    equal(err, null, 'Expected no error making peer request');
  }

  // Make a request to the server and get a failure response
  try {
    const got = await makePeerRequest({
      type: failureType,
      lnd: target.lnd,
      timeout: 1000,
      to: id,
    });

    strictSame(got, null, 'Expected failure response for failure type');
  } catch (err) {
    strictSame(err, failure, 'Got failure response for failure type');
  }

  await kill({});

  return end();
});
