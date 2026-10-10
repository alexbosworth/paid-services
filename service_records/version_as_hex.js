const numberAsTruncated = require('./number_as_truncated');

const {isSafeInteger} = Number;

/** Encode a service version as a tu64 number

  A version is the major version of a service. Changes that readers can
  ignore are made with odd records and do not change the version.

  {
    version: <Service Version Number>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Encoded Version Hex String>
  }
*/
module.exports = ({version}) => {
  if (!isSafeInteger(version) || version < 0) {
    throw new Error('ExpectedVersionNumberToEncodeServiceVersion');
  }

  return numberAsTruncated({number: String(version)});
};
