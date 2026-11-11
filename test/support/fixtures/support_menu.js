const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {encodeTlvStream} = require('bolt01');
const {signSchnorr} = require('tiny-secp256k1');

const {addServiceLabel} = require('./../../../service_records');
const encode = require('./../../../support/encode_support_menu');
const preimage = require('./../../../support/menu_signature_preimage');

const artIssuer = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const expiresAt = '2100-01-01T00:00:00.000Z';
const expiry = {type: '6', value: 'f4865700'};
const menuId = '0a'.repeat(16);
const musicIssuer = '024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';
const node = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967';

/** Make the offers and pages that the support menu tests share

  Pages are signed for the art offer, a support offer of the key of secret 1.
  Offer paths start at the node of secret 9 and are blinded with random keys,
  so these are made once and every test gets the same ones.

  @returns
  {
    art: <Support Offer That Pages Are Signed For String>
    expiry: <Expiry Record of the Start of 2100 Object>
    idRecord: <Menu Id Record of the Pages Object>
    music: <Offer of the Key of Secret 2 String>
    oddRecords: [<Page Record With Unknown Odd Records Object>]
    oddSigned: <Signed Page With Unknown Odd Records Object>
    offers: [<Offer With Paths String>]
    page: <Arguments to Encode a First Page of One Page With Object>
    paths: [<Offer Path Object>]
    signRecords: <Sign a Menu of Records Function>
    signature: <Signature of the Page of the Music Offer Hex String>
    signed: <Signed Page of the Music Offer Object>
    unsigned: <Page of the Music Offer Object>
    withPaths: <Offer With Paths String>
  }
*/
module.exports = (() => {
  const blinded = blindedPathFromHops({hops: [node]});

  // The paths of offers, from the node of secret 9
  const paths = [{
    hops: blinded.path,
    introduction_node: node,
    key: blinded.key,
  }];

  // The support offer that pages are signed for, made by the key of secret 1
  const art = addServiceLabel({
    id: '0a'.repeat(16),
    offer: createOffer({
      description: 'art',
      issuer_id: artIssuer,
      networks: ['regtest'],
    })
    .offer,
    type: '1',
    version: 1,
  })
  .offer;

  // An offer of the key of secret 2
  const music = createOffer({
    description: 'music',
    issuer_id: musicIssuer,
    networks: ['regtest'],
  })
  .offer;

  // An offer with paths, and offers with paths that only a few fit on a page
  const withPaths = createOffer({
    paths,
    description: 'paths',
    issuer_id: artIssuer,
  })
  .offer;

  const offers = Array(7).fill(null).map((n, i) => createOffer({
    paths,
    description: `offer ${i}`,
    issuer_id: artIssuer,
  })
  .offer);

  // The menu id record of the pages
  const idRecord = {type: '8', value: menuId};

  // The arguments to encode a first page of one page with
  const page = {expires_at: expiresAt, menu_id: menuId, page: 0, pages: 1};

  // Sign a menu for the art offer, with the key of secret 1
  const signMenu = menu => {
    const {hash} = preimage({menu, offer: art});

    const signature = signSchnorr(
      Buffer.from(hash, 'hex'),
      Buffer.alloc(32, 1)
    );

    return {menu, signature: Buffer.from(signature).toString('hex')};
  };

  // Sign a menu of records
  const signRecords = records => signMenu(encodeTlvStream({records}).encoded);

  // A page of the music offer, signed
  const unsigned = encode({...page, entries: [{offer: music}]});

  const {signature} = signMenu(unsigned.menu);

  const signed = encode({...page, signature, entries: [{offer: music}]});

  // A page with unknown odd records before and after its signature, signed
  const oddRecords = [
    expiry,
    {type: '7', value: '00'},
    idRecord,
    {type: '241', value: '01'},
  ];

  const oddSigned = signRecords(oddRecords);

  return {
    art,
    expiry,
    idRecord,
    music,
    oddRecords,
    oddSigned,
    offers,
    page,
    signRecords,
    signature,
    signed,
    unsigned,
    withPaths,
  };
})();
