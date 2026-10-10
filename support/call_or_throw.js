/** Call a method that can throw, throwing an error of its own when it throws

  The error of the method is replaced so that a caller sees an error that
  says what could not be read.

  {
    error: <Error Message String>
    method: <Method Function>
  }

  @throws
  <Error>

  @returns
  <Method Result Object>
*/
module.exports = ({error, method}) => {
  try {
    return method();
  } catch (err) {
    throw new Error(error);
  }
};
