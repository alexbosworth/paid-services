const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {createOffer} = require('invoices');

const {addInvoiceError} = require('./fixtures/serve_support_offer');
const {asKey} = require('./fixtures/serve_support_offer');
const {badMenuRequest} = require('./fixtures/serve_support_offer');
const {ended} = require('./fixtures/serve_support_offer');
const {episode} = require('./fixtures/service_support_offer');
const {firstPage} = require('./fixtures/serve_support_offer');
const {guest} = require('./fixtures/service_support_offer');
const {idle} = require('./fixtures/serve_support_offer');
const {level} = require('./fixtures/serve_support_offer');
const {listed} = require('./fixtures/service_support_offer');
const {makeMenuRequest} = require('./fixtures/serve_support_offer');
const {makeReceived} = require('./fixtures/serve_support_offer');
const {makeRequest} = require('./fixtures/service_support_offer');
const {menuUnavailable} = require('./fixtures/serve_support_offer');
const {nest} = require('./fixtures/serve_support_offer');
const {nested} = require('./fixtures/serve_support_offer');
const {offer} = require('./fixtures/service_support_offer');
const {otherMenuRequest} = require('./fixtures/serve_support_offer');
const {others} = require('./fixtures/service_support_offer');
const {otherSupport} = require('./fixtures/serve_support_offer');
const {paths} = require('./fixtures/service_support_offer');
const {plain} = require('./fixtures/service_support_offer');
const {serve} = require('./fixtures/serve_support_offer');
const {tip} = require('./fixtures/service_support_offer');

const addInvoiceFailure = [503, 'FailedToCreateInvoiceForSupporter'];
const issuer = '0362c0a046dacce86ddd0343c6d3c7c79c2208ba0d9c9cf24a6d046d21d21f90f7';

const tests = [
  {
    args: {
      related: [{offer}],
      steps: [{received: [makeReceived(makeMenuRequest())]}],
    },
    description: 'A menu request is sent the menu',
    expected: {...idle, menus: [firstPage], replies: [1366]},
  },
  {
    args: {related: 'offer'},
    description: 'Related offers are a list',
    error: 'ExpectedArrayOfRelatedOffersToServiceSupportOffer',
  },
  {
    args: {related: [{offer: 'offer'}]},
    description: 'Related offers are valid offers',
    error: 'ExpectedRelatedOffersToServiceSupportOffer',
  },
  {
    args: {related: [{bip353_name: 'guest'}]},
    description: 'A reference needs a name and an issuer id',
    error: 'ExpectedRelatedOffersToServiceSupportOffer',
  },
  {
    args: {
      related: [{
        offer: createOffer({
          issuer_id: asKey(6),
          networks: ['regtest'],
          paths: Array(4).fill(paths[0]),
        })
        .offer,
      }],
    },
    description: 'An offer with many paths is too large for a menu page',
    expected: ended('ExpectedRelatedOfferThatFitsOnAMenuPage'),
  },
  {
    args: {
      related: [{
        offer: createOffer({
          issuer_id: issuer,
          networks: ['regtest'],
          paths: Array(4).fill(paths[0]),
        })
        .offer,
      }],
      steps: [{received: [makeReceived(makeMenuRequest())]}],
    },
    description: 'An offer of the issuer with many paths is listed pathless',
    expected: {...idle, menus: [firstPage], replies: [1366]},
  },
  {
    args: {
      related: [{
        offer: createOffer({
          paths,
          description: 'x'.repeat(300),
          issuer_id: asKey(6),
          networks: ['regtest'],
        })
        .offer,
      }],
      steps: [{received: [makeReceived(makeMenuRequest(), 8)]}],
    },
    description: 'A page that does not fit in a regular reply is an error',
    expected: {
      ...idle,
      invoice_errors: [['2000805805', 'SupportMenuPageTooLarge', asKey(4)]],
      replies: [1366],
    },
  },
  {
    args: {
      related: others.map(offer => ({offer})),
      steps: [{
        received: [
          makeReceived(makeMenuRequest({page: 0}), 3),
          makeReceived(makeMenuRequest({page: 1})),
          makeReceived(makeMenuRequest({page: 99})),
        ],
      }],
    },
    description: 'A menu that does not fit on a page is split into pages',
    expected: {
      ...idle,
      invoice_errors: [['2000805805', 'UnknownSupportMenuPage', asKey(4)]],
      menus: [firstPage, {...firstPage, page: 1}],
      replies: [1366, 1366, 1366],
      signatures: 3,
    },
  },
  {
    args: {
      steps: [{
        received: [
          makeReceived(makeMenuRequest(), 9),
          makeReceived(makeMenuRequest(), 8),
        ],
      }],
    },
    description: 'Menu requests with long reply paths are ignored',
    expected: {...idle, menus: [firstPage], replies: [1366]},
  },
  {
    args: {
      steps: [
        {received: [makeReceived(makeMenuRequest())]},
        {hours: 23.5, received: [makeReceived(makeMenuRequest())]},
      ],
    },
    description: 'Signed menus are signed again before they expire',
    expected: {
      ...idle,
      menus: [firstPage, firstPage],
      replies: [1366, 1366],
      signatures: 2,
    },
  },
  {
    args: {
      steps: [
        {received: [makeReceived(makeMenuRequest())]},
        {hours: 23.5, received: [makeReceived(makeMenuRequest())]},
        {hours: 50, received: [makeReceived(makeMenuRequest())]},
      ],
    },
    description: 'An expired menu is signed again before it is sent',
    expected: {
      ...idle,
      menus: [firstPage, firstPage, firstPage],
      replies: [1366, 1366, 1366],
      signatures: 3,
    },
  },
  {
    args: {
      related: [{
        offer: createOffer({description: 'bitcoin', issuer_id: issuer})
          .offer,
      }],
    },
    description: 'Related offers are for the network of the offer',
    expected: ended('ExpectedRelatedOffersForSupportOfferNetwork'),
  },
  {
    args: {
      signs: 1,
      steps: [{}, {hours: 50, received: [makeReceived(makeMenuRequest())]}],
    },
    description: 'A menu request without signed pages is sent an error',
    expected: {
      ...idle,
      errors: [[503, 'FailedToSignSupportMenu']],
      invoice_errors: [menuUnavailable],
      replies: [1366],
    },
  },
  {
    args: {
      related: listed.map(offer => ({offer})).concat({
        bip353_name: 'guest@example.com',
        issuer_id: asKey(6),
      }),
      steps: [{received: [makeReceived(makeMenuRequest())]}],
    },
    description: 'Offers of the issuer are listed without their paths',
    expected: {...idle, menus: [firstPage], replies: [1366]},
  },
  {
    args: {
      related: listed.map(offer => ({offer})),
      steps: [{
        received: [
          makeReceived(makeRequest({to: listed[0]})),
          makeReceived(makeMenuRequest({to: listed[0]})),
        ],
      }],
    },
    description: 'An offer listed without its paths is paid but has no menu',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [menuUnavailable, addInvoiceError],
      invoices: 1,
      replies: [1366, 1366],
    },
  },
  {
    args: {
      related: nested,
      steps: [{received: [makeReceived(makeMenuRequest({to: episode}))]}],
    },
    description: 'A related support offer of the issuer can have a menu',
    expected: {
      ...idle,
      menus: [{...firstPage, offer: episode}],
      replies: [1366],
      signatures: 2,
    },
  },
  {
    args: {
      related: nested,
      steps: [{
        received: [
          makeReceived(makeMenuRequest({to: guest})),
          makeReceived(makeRequest({to: tip})),
        ],
      }],
    },
    description: 'Offers on the menu of a related offer are answered here',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [menuUnavailable, addInvoiceError],
      invoices: 1,
      replies: [1366, 1366],
      signatures: 2,
    },
  },
  {
    args: {related: [{offer: otherSupport(), related: []}]},
    description: 'A support offer of another issuer cannot have a menu',
    expected: ended('ExpectedRelatedMenuOnlyForAnsweredSupportOffer'),
  },
  {
    args: {related: [{offer: plain, related: []}]},
    description: 'An offer that is not a support offer cannot have a menu',
    expected: ended('ExpectedRelatedMenuOnlyForAnsweredSupportOffer'),
  },
  {
    args: {related: [{offer, related: []}]},
    description: 'The support offer itself cannot have another menu',
    expected: ended('ExpectedOneMenuForEachRelatedSupportOffer'),
  },
  {
    args: {related: [{offer: plain, related: 'x'}]},
    description: 'Related offers of a related offer are a list',
    error: 'ExpectedRelatedOffersToServiceSupportOffer',
  },
  {
    args: {
      steps: [
        {
          received: [
            makeReceived(badMenuRequest()),
            makeReceived(otherMenuRequest()),
          ],
        },
      ],
    },
    description: 'A menu request that is not valid is not replied to',
    expected: idle,
  },
  {
    args: {related: nest(level().slice(0, 4))},
    description: 'Related menus can be nested four levels deep',
    expected: {...idle, signatures: 5},
  },
  {
    args: {related: nest(level())},
    description: 'Related menus are not nested more than four levels deep',
    error: 'ExpectedRelatedOffersToServiceSupportOffer',
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(serve(args), new Error(error), 'Got error');
    }

    deepStrictEqual(await serve(args), expected, 'Got expected result');
  });
});
