const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const encodeSwapOptions = require('./encode_swap_options');
const {swapRequestOptions} = require('./swap_field_types');
const {swapRestartTypes} = require('./swap_field_types');

const findType = (t, types) => types.find(n => swapRequestOptions[n] === t);
const {keys} = Object;
const nonEmpty = records => records.filter(n => !!n.value);
const {typeFundRoutingFeeRate} = swapRestartTypes;
const {typeMaxDepositFee} = swapRestartTypes;
const {typeMaxFundFeeRate} = swapRestartTypes;
const {typeMinConfirmations} = swapRestartTypes;
const {typeSwapOptions} = swapRestartTypes;
const {typeSwapRecovery} = swapRestartTypes;
const {typeSwapRequest} = swapRestartTypes;
const {typeSwapResponse} = swapRestartTypes;
const {typeSweepAddress} = swapRestartTypes;
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');

/** Encode a restart for an off to on swap request

  {
    [is_avoiding_broadcast]: <Avoid Sweep Broadcast Bool>
    [is_external_funding]: <Avoid Internal Payment Bool>
    [is_loop_service]: <Use Lightning Loop Service Bool>
    [is_uncooperative]: <Avoid Cooperative Signature Bool>
    max_deposit_fee: <Maximum Fee For Deposit Tokens Number>
    [max_fund_fee_rate]: <Maximum Funding Routing Fee Rate Number>
    [min_confirmations]: <Minimum Confirmations Wait Number>
    recovery: <Swap Recovery Hex String>
    request: <Swap Request Hex String>
    response: <Swap Response Hex String>
    [sweep_address]: <Swap Sweep Chain Address String>
  }

  @returns
  {
    restart: <Restart Request Hex String>
  }
*/
module.exports = args => {
  const options = [];
  const types = keys(swapRequestOptions);

  if (!!args.is_avoiding_broadcast) {
    options.push(findType('avoiding_broadcast', types));
  }

  if (!!args.is_external_funding) {
    options.push(findType('external_funding', types));
  }

  if (!!args.is_loop_service) {
    options.push(findType('loop_service', types));
  }

  if (!!args.is_uncooperative) {
    options.push(findType('uncooperative', types));
  }

  const records = [
    {
      type: typeMaxDepositFee,
      value: encodeBigSize({number: args.max_deposit_fee}).encoded,
    },
    {
      type: typeSwapOptions,
      value: encodeSwapOptions({options: options.map(n => Number(n))}).encoded,
    },
    {
      type: typeSwapRecovery,
      value: args.recovery,
    },
    {
      type: typeSwapRequest,
      value: args.request,
    },
    {
      type: typeSwapResponse,
      value: args.response,
    },
  ];

  if (args.max_fund_fee_rate !== undefined) {
    records.push({
      type: typeMaxFundFeeRate,
      value: encodeBigSize({number: args.max_fund_fee_rate}).encoded,
    });
  }

  if (!!args.min_confirmations) {
    records.push({
      type: typeMinConfirmations,
      value: encodeBigSize({number: args.min_confirmations}).encoded,
    });
  }

  if (!!args.sweep_address) {
    records.push({
      type: typeSweepAddress,
      value: utf8AsHex(args.sweep_address),
    });
  }

  return {restart: encodeTlvStream({records: nonEmpty(records)}).encoded};
};
