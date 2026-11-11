const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {createSignedInvoiceRequest} = require('invoices');
const {createUnsignedInvoiceRequest} = require('invoices');
const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {pointFromScalar} = require('tiny-secp256k1');

const {addServiceLabel} = require('./../../../service_records');

const identity = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const issuer = '0362c0a046dacce86ddd0343c6d3c7c79c2208ba0d9c9cf24a6d046d21d21f90f7';
const otherIssuer = '03f006a18d5653c4edf5391ff23a61f03ff83d237e880ee61187fa9f379a028e0a';
const pathId = '01'.repeat(32);

/** Make the offers and the request that the support offer service tests share

  Offers are of the issuer of secret 5, on a path to the node of secret 1 with
  a path id of 32 bytes of 0x01. The path is blinded with random keys, so these
  are made once and every test gets the same ones.

  @returns
  {
    episode: <Related Support Offer String>
    expired: <Offer That Expired String>
    expiring: <Offer That Expires in 2100 String>
    guest: <Support Offer Listed on the Related Menu String>
    listed: [<Offer Listed Without Its Paths String>]
    makeOffer: <Make an Offer of the Issuer Function>
    makeRequest: <Make a Signed Request From a Payer to Pay an Offer Function>
    offer: <Support Offer That Is Serviced String>
    others: [<Offer of Another Issuer String>]
    path: {
      key: <Path Key Hex String>
      path: [<Blinded Hop Object>]
    }
    paths: [<Offer Path Object>]
    plain: <Offer of the Issuer String>
    request: <Request to Pay the Offer Hex String>
    tip: <Offer Listed on the Related Menu String>
  }
*/
module.exports = (() => {
  // Get the public key of a secret of 32 bytes of a number
  const asKey = n => {
    return Buffer.from(pointFromScalar(Buffer.alloc(32, n))).toString('hex');
  };

  const path = blindedPathFromHops({hops: [identity], id: pathId});

  // The paths of offers, to self
  const paths = [{
    hops: path.path,
    introduction_node: identity,
    key: path.key,
  }];

  // Make an offer of the issuer, labeled for support when it has a label id
  const makeOffer = args => {
    const {offer} = createOffer({
      paths,
      description: args.description || 'support',
      expires_at: args.expires_at,
      issuer_id: args.issuer_id || issuer,
      max_quantity: args.max_quantity,
      networks: args.networks || ['regtest'],
    });

    // Exit early when the offer is not labeled
    if (!args.id) {
      return offer;
    }

    return addServiceLabel({
      offer,
      id: args.id,
      type: args.type || '1',
      version: args.major || 1,
    })
    .offer;
  };

  const offer = makeOffer({id: '0d'.repeat(16)});

  // Make a signed request from a payer to pay an offer, with records added
  const makeRequest = ({mtokens, payer, records, to}) => {
    const payerSecret = Buffer.alloc(32, payer || 2);

    const unsigned = createUnsignedInvoiceRequest({
      metadata: '00',
      mtokens: mtokens || '1000',
      network: 'regtest',
      offer: to || offer,
      payer_id: asKey(payer || 2),
    });

    const {encoded} = encodeTlvStream({
      records: decodeTlvStream({encoded: unsigned.encoded}).records
        .map(({type, value}) => ({type, value}))
        .concat(records || []),
    });

    return createSignedInvoiceRequest({
      encoded,
      secret: payerSecret.toString('hex'),
    })
    .encoded;
  };

  // A request to pay the offer, which is the same each time it is sent
  const request = makeRequest({});

  // Offers of the issuer that are listed on a menu without their paths
  const listed = [1, 2, 3, 4, 5].map(n => makeOffer({
    description: `offer ${n}`,
    id: Buffer.alloc(16, n).toString('hex'),
  }));

  // Offers of another issuer are listed whole, needing more than one page
  const others = [1, 2, 3, 4, 5, 6].map(n => makeOffer({
    description: `offer ${n}`,
    issuer_id: otherIssuer,
  }));

  // A related support offer with a menu that lists two offers of the issuer
  const episode = makeOffer({description: 'episode', id: '0e'.repeat(16)});
  const guest = makeOffer({description: 'guest', id: '0f'.repeat(16)});
  const tip = makeOffer({description: 'tip'});

  const plain = makeOffer({description: 'plain'});

  // An offer of the issuer that has expired, and the same offer before then
  const expired = makeOffer({
    description: 'expiring',
    expires_at: '2025-01-01T00:00:00.000Z',
  });

  const expiring = makeOffer({
    description: 'expiring',
    expires_at: '2100-01-01T00:00:00.000Z',
  });

  return {
    episode,
    expired,
    expiring,
    guest,
    listed,
    makeOffer,
    makeRequest,
    offer,
    others,
    path,
    paths,
    plain,
    request,
    tip,
  };
})();
