const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const decodeSwapOptions = require('./decode_swap_options');
const {swapRequestOptions} = require('./swap_field_types');
const {swapRestartTypes} = require('./swap_field_types');

const decodeNumber = encoded => BigInt(decodeBigSize({encoded}).decoded);
const findRecord = (records, type) => records.find(n => n.type === type);
const hasOption = (options, named) => !!options.find(n => n.named === named);
const hexAsUtf8 = n => !!n ? Buffer.from(n.value, 'hex').toString('utf8') : '';
const {typeFundRoutingFeeRate} = swapRestartTypes;
const {typeMaxDepositFee} = swapRestartTypes;
const {typeMaxFundFeeRate} = swapRestartTypes;
const {typeMinConfirmations} = swapRestartTypes;
const {typeSwapOptions} = swapRestartTypes;
const {typeSwapRecovery} = swapRestartTypes;
const {typeSwapRequest} = swapRestartTypes;
const {typeSwapResponse} = swapRestartTypes;
const {typeSweepAddress} = swapRestartTypes;

/** Decode restart details for an off to on swap

  {
    restart: <Hex Encoded Restart Off to On Swap Details String>
  }

  @throws
  <Error>

  @returns
  {
    [is_avoiding_broadcast]: <Avoid Sweep Broadcast Bool>
    [is_external_funding]: <Avoid Internal Payment Bool>
    [is_loop_service]: <Use Lightning Loop Service Bool>
    [is_uncooperative]: <Avoid Cooperative Signature Bool>
    max_deposit_fee: <Maximum Fee For Deposit Tokens Number>
    [max_fund_fee_rate]: <Maximum Funding Routing Fee Rate Number>
    [min_confirmations]: <Minimum Confirmations Wait Number>
    recovery: <Swap Request Recovery Hex String>
    request: <Swap Request Hex String>
    response: <Swap Response Hex String>
    [sweep_address]: <Swap Sweep Chain Address String>
  }
*/
module.exports = ({restart}) => {
  const {records} = decodeTlvStream({encoded: restart});

  const optionsRecord = findRecord(records, typeSwapOptions) || {};

  const {options} = decodeSwapOptions({encoded: optionsRecord.value});

  const maxDepositFeeRecord = findRecord(records, typeMaxDepositFee);
  const minConfsRecord = findRecord(records, typeMinConfirmations);
  const rateRecord = findRecord(records, typeMaxFundFeeRate);
  const recoveryRecord = findRecord(records, typeSwapRecovery);
  const requestRecord = findRecord(records, typeSwapRequest);
  const responseRecord = findRecord(records, typeSwapResponse);
  const sweepAddressRecord = findRecord(records, typeSweepAddress);

  const confs = !!minConfsRecord ? decodeNumber(minConfsRecord.value) : null;
  const rate = !!rateRecord ? decodeNumber(rateRecord.value) : null;

  return {
    is_avoiding_broadcast: hasOption(options, 'avoiding_broadcast'),
    is_external_funding: hasOption(options, 'external_funding'),
    is_loop_service: hasOption(options, 'loop_service'),
    is_uncooperative: hasOption(options, 'uncooperative'),
    max_deposit_fee: Number(decodeNumber(maxDepositFeeRecord.value)),
    max_fund_fee_rate: !!rateRecord ? Number(rate) : undefined,
    min_confirmations: Number(confs) || undefined,
    recovery: recoveryRecord.value,
    request: requestRecord.value,
    response: responseRecord.value,
    sweep_address: hexAsUtf8(sweepAddressRecord) || undefined,
  };
};
