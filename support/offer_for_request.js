const {parseInvoiceRequest} = require('invoices');

const erroneousRequestField = require('./erroneous_request_field');
const readMenuRequest = require('./read_menu_request');
const tlvStreamRecords = require('./tlv_stream_records');
const {typeMenuRequest} = require('./constants');

const ignoredMenuRequest = {is_ignored: true, is_menu: true};
const isMenuRequest = n => n.type === typeMenuRequest;

/** Find the serviced offer for a received invoice request

  A request that did not arrive on the path of a serviced offer is ignored.
  A request on an offer path that is not a valid request for the offer
  returns an error to send back, with the `request` when it could be parsed.

  A request with the menu request record is a menu request, counted as one
  before it is read. A menu request that is not valid under BOLT 12, or not
  for an offer of its path, is `is_ignored`. One with an option that is not
  understood returns an error to send back.

  {
    offers: [{
      offer: <BOLT 12 Offer String>
      path_id: <Offer Blinded Path Identifier Hex String>
    }]
    [path_id]: <Received On Blinded Path Identifier Hex String>
    value: <Invoice Request TLV Stream Hex String>
  }

  @returns
  {
    [error]: {
      [erroneous_field]: <Erroneous Record Type Number String>
      message: <Error Message String>
    }
    [is_ignored]: <Menu Request Is Not Replied To Bool>
    [is_menu]: <Request Is Asking For The Menu Bool>
    [page]: <Menu Page Number Number>
    [offer]: {
      offer: <BOLT 12 Offer String>
      path_id: <Offer Blinded Path Identifier Hex String>
    }
    [request]: <Parsed Invoice Request Object>
  }
*/
module.exports = args => {
  // Exit early when the request did not arrive on a path
  if (!args.path_id) {
    return {};
  }

  const onPath = args.offers.filter(n => n.path_id === args.path_id);

  // Exit early when the request did not arrive on a serviced offer path
  if (!onPath.length) {
    return {};
  }

  // The menu request record is looked for before the request is checked,
  // since a menu request that is not valid is not replied to
  const {records} = tlvStreamRecords({encoded: args.value});

  const menuRequest = (records || []).find(isMenuRequest);

  let request;

  try {
    request = parseInvoiceRequest({encoded: args.value});
  } catch (err) {
    // Exit early when a menu request is not valid under BOLT 12
    if (!!menuRequest) {
      return ignoredMenuRequest;
    }

    return {
      error: {
        erroneous_field: erroneousRequestField({
          message: err.message,
        }).erroneous_field,
        message: err.message,
      },
    };
  }

  const offer = onPath.find(n => !!request.offer && n.offer === request.offer);

  // Exit early when a menu request is not for an offer of the path
  if (!!menuRequest && !offer) {
    return ignoredMenuRequest;
  }

  // Exit early when the request is not a request for an offer
  if (!request.offer) {
    return {request, error: {message: 'ExpectedInvoiceRequestForOffer'}};
  }

  // Exit early when the request is not for the offer of the path
  if (!offer) {
    return {request, error: {message: 'UnknownOfferForInvoiceRequest'}};
  }

  // Exit early when the request is a request for an invoice
  if (!menuRequest) {
    return {offer, request};
  }

  const {page} = readMenuRequest({encoded: menuRequest.value});

  // Exit early when the menu request has options that are not understood
  if (page === undefined) {
    return {
      offer,
      request,
      error: {
        erroneous_field: typeMenuRequest,
        message: 'UnsupportedSupportMenuRequest',
      },
      is_menu: true,
    };
  }

  return {offer, page, request, is_menu: true};
};
