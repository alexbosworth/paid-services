const {deepStrictEqual, rejects} = require('node:assert/strict');
const {mock} = require('node:test');
const {test} = require('node:test');

const {createInvoiceError} = require('invoices');
const {createOffer} = require('invoices');
const {decodeTlvStream} = require('bolt01');
const {makeLnd} = require('mock-lnd');
const {parseInvoiceRequest} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');
const {signSchnorr} = require('tiny-secp256k1');

const addOfferRecords = require('./../../support/add_offer_records');
const {addServiceLabel} = require('./../../service_records');
const createMenuRequest = require('./../../support/create_menu_request');
const decodeEntry = require('./../../support/decode_menu_entry');
const encodeEntry = require('./../../support/encode_menu_entry');
const encodeSupportMenu = require('./../../support/encode_support_menu');
const {episode} = require('./fixtures/get_support_menu');
const {forNetworks} = require('./fixtures/get_support_menu');
const {guest} = require('./fixtures/get_support_menu');
const isSupportOffer = require('./../../support/is_support_offer');
const {label} = require('./fixtures/get_support_menu');
const {labeled} = require('./fixtures/get_support_menu');
const menuOffers = require('./../../support/menu_offers');
const network = require('./../../network');
const {ownPaths} = require('./fixtures/get_support_menu');
const {paths} = require('./fixtures/get_support_menu');
const {plain} = require('./fixtures/get_support_menu');
const preimage = require('./../../support/menu_signature_preimage');
const {reached} = require('./fixtures/get_support_menu');
const {regtest} = require('./fixtures/get_support_menu');
const {regtestAndTestnet} = require('./fixtures/get_support_menu');
const {supportOffer} = require('./fixtures/get_support_menu');

const {entries} = Object;
const {fromEntries} = Object;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const hourFromNow = () => new Date(Date.now() + 1000 * 60 * 60).toISOString();
const isFuture = date => Date.parse(date) > Date.now();
const issuer = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const menuId = '0a'.repeat(16);
const node = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967';
const notAnswered = '01047741dfad0517537570706f72744d656e7550616765546f6f4c61726765fe000c4baf00';
const other = '024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';
const secret = '04'.repeat(32);
const unreadable = '050b537570706f72744d656e75fe000c4bad1208100a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a';
const version = 1;

// Get the public key of a secret of 32 bytes of a number
const asKey = n => {
  return Buffer.from(pointFromScalar(Buffer.alloc(32, n))).toString('hex');
};

// Reply to a menu request with the reply the fake LND has, keeping the request
const fakeReply = (args, cbk) => {
  args.lnd.requests.push({
    max_reply_hops: args.max_reply_hops,
    message: args.message,
    path: args.path,
  });

  return cbk(null, {reply: args.lnd.reply});
};

// Replies are faked, so that no onion messages are sent
mock.method(network, 'requestNetworkReply', fakeReply);

const getSupportMenu = require('./../../support/get_support_menu');

// A field has a value
const isDefined = ([, v]) => v !== undefined;

// Leave out the fields that have no value
const defined = n => fromEntries(entries(n).filter(isDefined));

// Make a menu request and read it back as an invoice request
const askFor = args => {
  const menu = createMenuRequest(args);

  const request = parseInvoiceRequest({encoded: menu.encoded});

  const menuRequest = decodeTlvStream({encoded: menu.encoded}).records
    .find(n => n.type === '2000805805');

  return defined({
    bip353_name: request.bip353_name,
    menu_request: menuRequest.value,
    mtokens: request.mtokens,
    offer: request.offer,
    payer_id: request.payer_id === menu.payer_id ? menu.payer_id : undefined,
  });
};

// Make two menu requests and see what they have that is the same
const askTwice = args => {
  const first = parseInvoiceRequest(createMenuRequest(args));
  const again = parseInvoiceRequest(createMenuRequest(args));

  return {
    is_same_metadata: first.metadata === again.metadata,
    is_same_payer_id: first.payer_id === again.payer_id,
  };
};

// Get the offers of a menu as a payer would show them
const listed = ({entries, offer}) => {
  return menuOffers({offer, menu: {entries}}).offers.map(defined);
};

// An offer on the menu as a payer shows it, from the issuer by default
const shown = (offer, details) => ({
  offer,
  is_same_issuer: true,
  is_support_offer: false,
  issuer_id: issuer,
  suggested_mtokens: [],
  ...details,
});

// Make a fake LND on regtest that has a reply to the menu request
const makeTestLnd = args => {
  // The node is on regtest, like the support offer, unless on mainnet
  const lnd = makeLnd({network: !args.is_mainnet ? 'regtest' : 'mainnet'});

  lnd.reply = args.reply;
  lnd.requests = [];

  return lnd;
};

// Make a page of the menu of the support offer, signed by a secret key
const makePage = args => {
  const page = {
    entries: args.entries || [{offer: episode}],
    expires_at: args.expires_at || hourFromNow(),
    menu_id: args.menu_id || menuId,
    page: args.page || 0,
    pages: args.pages || 1,
  };

  const {hash} = preimage({
    menu: encodeSupportMenu(page).menu,
    offer: supportOffer,
  });

  // The page is signed by the issuer unless another key is given
  const signature = Buffer.from(signSchnorr(
    hexAsBuffer(hash),
    Buffer.alloc(32, args.signer || 1)
  ));

  const signed = {...page, signature: signature.toString('hex')};

  const {encoded} = encodeSupportMenu(!args.is_unsigned ? signed : page);

  return createInvoiceError({message: 'SupportMenu'}).encoded + encoded;
};

// Get the menu of the support offer from a fake recipient and summarize it
const getMenu = async args => {
  const lnd = makeTestLnd(args);

  const got = await getSupportMenu({
    lnd,
    menu_id: args.menu_id,
    offer: supportOffer,
    page: args.page,
  });

  const [request] = lnd.requests;

  return {
    is_unexpired: isFuture(got.expires_at),
    max_reply_hops: request.max_reply_hops,
    menu_id: got.menu_id,
    offers: got.offers.map(defined),
    page: got.page,
    pages: got.pages,
    path_introduction: request.path.introduction_node,
    suggested_mtokens: got.suggested_mtokens,
  };
};

// The menu as a payer gets it, with a request that has a reply path limit
const gotMenu = {
  is_unexpired: true,
  max_reply_hops: 8,
  menu_id: menuId,
  offers: [
    shown(episode, {
      description: 'episode',
      is_support_offer: true,
      service: {id: '0d'.repeat(16), type: '1', version: 1},
    }),
  ],
  page: 0,
  pages: 1,
  path_introduction: node,
  suggested_mtokens: [],
};

const tests = [
  {
    args: {offer: 'offer'},
    description: 'LND is expected',
    error: [400, 'ExpectedLndToGetSupportMenu'],
    method: getSupportMenu,
  },
  {
    args: {lnd: {}},
    description: 'An offer is expected',
    error: [400, 'ExpectedSupportOfferToGetSupportMenu'],
    method: getSupportMenu,
  },
  {
    args: {lnd: {}, offer: 'offer'},
    description: 'A valid offer is expected',
    error: [400, 'ExpectedValidOfferToGetSupportMenu'],
    method: getSupportMenu,
  },
  {
    args: {
      lnd: {},
      offer: createOffer({issuer_id: issuer, networks: ['regtest']}).offer,
    },
    description: 'A support offer is expected',
    error: [400, 'ExpectedSupportOfferToGetSupportMenu'],
    method: getSupportMenu,
  },
  {
    args: {lnd: {}, offer: label({issuer_id: issuer, paths: undefined})},
    description: 'A labeled offer without a path is not a support offer',
    error: [400, 'ExpectedSupportOfferToGetSupportMenu'],
    method: getSupportMenu,
  },
  {
    args: {
      lnd: {},
      offer: label({issuer_id: issuer, networks: ['regtest', 'testnet']}),
    },
    description: 'A support offer is for one network',
    error: [400, 'ExpectedSupportOfferToGetSupportMenu'],
    method: getSupportMenu,
  },
  {
    args: {lnd: {}, menu_id: '00', offer: supportOffer},
    description: 'A menu id is 16 bytes',
    error: [400, 'ExpectedMenuIdHexToGetSupportMenu'],
    method: getSupportMenu,
  },
  {
    args: {lnd: {}, offer: supportOffer, timeout: 0},
    description: 'A timeout is a positive number of milliseconds',
    error: [400, 'ExpectedPositiveTimeoutToGetSupportMenu'],
    method: getSupportMenu,
  },
  {
    args: {lnd: {}, offer: supportOffer, timeout: 1.5},
    description: 'A timeout is a whole number of milliseconds',
    error: [400, 'ExpectedPositiveTimeoutToGetSupportMenu'],
    method: getSupportMenu,
  },
  {
    args: {reply: {type: '68', value: makePage({})}},
    description: 'A signed page of the menu is returned',
    expected: gotMenu,
    method: getMenu,
  },
  {
    args: {menu_id: menuId, reply: {type: '68', value: makePage({})}},
    description: 'A page of the menu already shown is returned',
    expected: gotMenu,
    method: getMenu,
  },
  {
    args: {is_mainnet: true, reply: {type: '68', value: makePage({})}},
    description: 'The support offer has to be for the network of the node',
    error: [400, 'ExpectedOfferForNodeNetworkToGetSupportMenu'],
    method: getMenu,
  },
  {
    args: {reply: {type: '66', value: '00'}},
    description: 'A recipient that sends an invoice does not have a menu',
    error: [503, 'ExpectedInvoiceErrorWithSupportMenu'],
    method: getMenu,
  },
  {
    args: {reply: {type: '68', value: '01'}},
    description: 'A reply that is not an invoice error is not a menu',
    error: [503, 'ExpectedValidInvoiceErrorWithSupportMenu'],
    method: getMenu,
  },
  {
    args: {reply: {type: '68', value: unreadable}},
    description: 'A page that cannot be read is not a menu',
    error: [503, 'ExpectedValidSupportMenuPage', {
      error: new Error('ExpectedExpiryInSupportMenu'),
    }],
    method: getMenu,
  },
  {
    args: {reply: {type: '68', value: notAnswered}},
    description: 'An error about the menu request is a request not answered',
    error: [503, 'SupportMenuRequestNotAnswered', {
      is_reply_too_large: true,
      message: 'SupportMenuPageTooLarge',
    }],
    method: getMenu,
  },
  {
    args: {
      reply: {
        type: '68',
        value: createInvoiceError({message: 'NoMenuHere'}).encoded,
      },
    },
    description: 'An error without a page means there is no menu support',
    error: [503, 'ExpectedSupportMenuInInvoiceError'],
    method: getMenu,
  },
  {
    args: {reply: {type: '68', value: makePage({is_unsigned: true})}},
    description: 'A page that is not signed is not used',
    error: [503, 'ExpectedSignedSupportMenuPage'],
    method: getMenu,
  },
  {
    args: {reply: {type: '68', value: makePage({signer: 2})}},
    description: 'A page that is not signed by the issuer is not used',
    error: [503, 'ExpectedValidSignatureForSupportMenuPage'],
    method: getMenu,
  },
  {
    args: {
      reply: {
        type: '68',
        value: makePage({expires_at: '2025-01-01T00:00:00.000Z'}),
      },
    },
    description: 'A page that has expired is not used',
    error: [503, 'ExpectedUnexpiredSupportMenuPage'],
    method: getMenu,
  },
  {
    args: {reply: {type: '68', value: makePage({page: 1, pages: 2})}},
    description: 'A page other than the page asked for is not used',
    error: [503, 'ExpectedRequestedSupportMenuPage'],
    method: getMenu,
  },
  {
    args: {
      menu_id: '0b'.repeat(16),
      reply: {type: '68', value: makePage({})},
    },
    description: 'A page from another menu than the pages shown is a change',
    error: [503, 'SupportMenuChanged', {menu_id: menuId}],
    method: getMenu,
  },
  {
    args: {offer: supportOffer},
    description: 'A support offer has a service id',
    expected: {is_support_offer: true},
    method: isSupportOffer,
  },
  {
    args: {
      offer: addServiceLabel({
        version,
        offer: createOffer({paths, issuer_id: issuer, networks: ['regtest']})
          .offer,
        type: '1',
      })
      .offer,
    },
    description: 'A labeled offer without a service id is not a support offer',
    expected: {is_support_offer: false},
    method: isSupportOffer,
  },
  {
    args: {offer: label({description: 'd', issuer_id: issuer, mtokens: '1'})},
    description: 'A support offer has no amount',
    expected: {is_support_offer: false},
    method: isSupportOffer,
  },
  {
    args: {
      offer: label({
        amount: '100',
        currency: 'USD',
        description: 'd',
        issuer_id: issuer,
      }),
    },
    description: 'A support offer has no currency',
    expected: {is_support_offer: false},
    method: isSupportOffer,
  },
  {
    args: {offer: label({issuer_id: issuer, max_quantity: 0})},
    description: 'A support offer has no quantity',
    expected: {is_support_offer: false},
    method: isSupportOffer,
  },
  {
    args: {offer: label({issuer_id: issuer, paths: undefined})},
    description: 'A support offer has paths',
    expected: {is_support_offer: false},
    method: isSupportOffer,
  },
  {
    args: {offer: label({})},
    description: 'A support offer has an issuer id',
    expected: {is_support_offer: false},
    method: isSupportOffer,
  },
  {
    args: {offer: labeled('1', 2)},
    description: 'A support offer is of a version that is supported',
    expected: {is_support_offer: false},
    method: isSupportOffer,
  },
  {
    args: {secret, offer: supportOffer},
    description: 'A menu request is an invoice request with the menu record',
    expected: {
      menu_request: '',
      mtokens: '1000',
      offer: supportOffer,
      payer_id: asKey(4),
    },
    method: askFor,
  },
  {
    args: {secret, offer: supportOffer, page: 3},
    description: 'A menu request can ask for a page of the menu',
    expected: {
      menu_request: '000103',
      mtokens: '1000',
      offer: supportOffer,
      payer_id: asKey(4),
    },
    method: askFor,
  },
  {
    args: {secret, bip353_name: 'alice@example.com', offer: supportOffer},
    description: 'A menu request has the name that the offer was found with',
    expected: {
      bip353_name: 'alice@example.com',
      menu_request: '',
      mtokens: '1000',
      offer: supportOffer,
      payer_id: asKey(4),
    },
    method: askFor,
  },
  {
    args: {offer: supportOffer},
    description: 'Each menu request has its own payer id and metadata',
    expected: {is_same_metadata: false, is_same_payer_id: false},
    method: askTwice,
  },
  {
    args: {entries: [{offer: episode}, {offer: guest}], offer: supportOffer},
    description: 'Menu offers show which offers are from the same issuer',
    expected: [
      shown(episode, {
        description: 'episode',
        is_support_offer: true,
        service: {id: '0d'.repeat(16), type: '1', version: 1},
      }),
      shown(guest, {
        description: 'guest',
        is_same_issuer: false,
        issuer_id: other,
      }),
    ],
    method: listed,
  },
  {
    args: {
      entries: [
        {offer: forNetworks(['bitcoin'])},
        {
          offer: createOffer({
            description: 'expired',
            expires_at: new Date(1e3).toISOString(),
            issuer_id: issuer,
            networks: ['regtest'],
          })
          .offer,
        },
      ],
      offer: supportOffer,
    },
    description: 'Menu offers for other networks or that expired are left out',
    expected: [],
    method: listed,
  },
  {
    args: {
      entries: [labeled('1', 1), labeled('1', 2), labeled('7', 1), plain]
        .map(offer => ({offer})),
      offer: supportOffer,
    },
    description: 'Menu offers of unknown services and versions are normal',
    expected: [
      shown(labeled('1', 1), {
        is_support_offer: true,
        service: {id: '0d'.repeat(16), type: '1', version: 1},
      }),
      shown(labeled('1', 2), {
        service: {id: '0d'.repeat(16), type: '1', version: 2},
      }),
      shown(labeled('7', 1), {
        service: {id: '0d'.repeat(16), type: '7', version: 1},
      }),
      shown(plain),
    ],
    method: listed,
  },
  {
    args: {
      entries: [
        {
          offer: addOfferRecords({
            offer: plain,
            records: [{type: '1000805805', value: '0001'}],
          })
          .offer,
        },
      ],
      offer: supportOffer,
    },
    description: 'Menu offers with labels that cannot be read are normal',
    expected: [
      shown(addOfferRecords({
        offer: plain,
        records: [{type: '1000805805', value: '0001'}],
      })
      .offer),
    ],
    method: listed,
  },
  {
    args: {
      entries: [
        {
          offer: addOfferRecords({
            offer: plain,
            records: [{type: '1000805807', value: '000800000000000003e8'}],
          })
          .offer,
        },
      ],
      offer: supportOffer,
    },
    description: 'Suggested amounts are from each menu offer',
    expected: [
      shown(addOfferRecords({
        offer: plain,
        records: [{type: '1000805807', value: '000800000000000003e8'}],
      })
      .offer, {suggested_mtokens: ['1000']}),
    ],
    method: listed,
  },
  {
    args: {
      entries: [
        {offer: regtest},
        {offer: forNetworks()},
        {offer: regtestAndTestnet},
        {offer: forNetworks(['testnet'])},
      ],
      offer: supportOffer,
    },
    description: 'Menu offers are for the network of the support offer',
    expected: [
      shown(regtest, {description: 'regtest'}),
      shown(regtestAndTestnet, {description: 'regtest,testnet'}),
    ],
    method: listed,
  },
  {
    args: {
      entries: [
        {offer: ownPaths, is_without_paths: true},
        {offer: guest, is_without_paths: true},
        {bip353_name: 'guest@example.com', issuer_id: other},
      ]
      .map(entry => decodeEntry({encoded: encodeEntry(entry).encoded})),
      offer: supportOffer,
    },
    description: 'Offers without paths get the paths of the support offer',
    expected: [
      shown(reached, {description: 'episode'}),
      {
        is_same_issuer: false,
        is_support_offer: false,
        issuer_id: other,
        reference: {
          bip353_name: 'guest@example.com',
          issuer_id: other,
          network: 'regtest',
        },
        suggested_mtokens: [],
      },
    ],
    method: listed,
  },
];

tests.forEach(({args, description, error, expected, method}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(method(args), error, 'Got error');
    }

    deepStrictEqual(await method(args), expected, 'Got expected result');
  });
});
